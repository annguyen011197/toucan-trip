import { Type, type Content, type FunctionDeclaration } from "@google/genai";
import type { ReviseRequest, TripComment } from "../types";
import { ToolExecutor, snapshot } from "../tools";
import { toISODate } from "../time";
import { LANG_PROMPT_NAME, type Lang } from "../i18n";
import { declarations, runToolLoop } from "./gemini";
import { handleEdit } from "./mock";

export interface Revision {
  text: string;
  appliedIds: string[];
}

/** Planner tools that change the plan (searches only help place new stops; their cards are dropped). */
const TOOLS = ["updateItinerary", "updateTripInfo", "searchPlaces"];

const finishDeclaration: FunctionDeclaration = {
  name: "finish",
  description: "Report what you changed. Always call this last.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      text: { type: Type.STRING, description: "1-3 short sentences for the trip owner: what changed, and why any comment was skipped" },
      skippedCommentIds: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Ids of comments you did not apply" },
    },
    required: ["text"],
  },
};

function revisePrompt(lang: Lang, tripLang: Lang, currency: string) {
  return `You are "Travel AI", the planner inside the Toucan Trip app. The trip owner shared their itinerary with friends,
who left comments on individual stops. The owner reviewed them and approved the ones in [approved comments].
Revise the itinerary so it reflects every approved comment:
- Each comment is about the stop in "stop" (itemId, day, title). "This", "here", "it" refer to that stop.
- Use updateItinerary (itemId from [trip state] for edit/move/remove) and updateTripInfo only when a comment asks for it.
- Keep everything else as it is: don't reorder, retime or rewrite stops nobody commented on, except to resolve a time clash you created.
- If comments conflict, follow the most specific one and mention the conflict.
- Skip a comment that is only praise, a question, or impossible to act on, and list its id in skippedCommentIds.
- New stops need realistic 24h "HH:mm" times, accurate lat/lng, address, category, note, tips and estCost in ${currency} per person.
  Never invent prices; estimate typical costs only.
- Write item titles, notes, tips and tags in ${LANG_PROMPT_NAME[tripLang]}. Write the finish text in ${LANG_PROMPT_NAME[lang]}.
End by calling finish.`;
}

const commentsForModel = (comments: TripComment[]) =>
  comments.map((c) => ({ id: c.id, author: c.authorName || "A friend", stop: { itemId: c.itemId, day: c.day, title: c.itemTitle }, comment: c.text }));

/** Applies approved comments to `tools.trip` with Gemini. */
export async function geminiRevise(req: ReviseRequest, tools: ToolExecutor, apiKey: string, debugScope = "revise"): Promise<Revision> {
  const contents: Content[] = [{
    role: "user",
    parts: [{
      text: `[today: ${toISODate(new Date())}]\n[trip state]\n${JSON.stringify(snapshot(tools.trip))}\n\n` +
        `[approved comments]\n${JSON.stringify(commentsForModel(req.comments))}`,
    }],
  }];
  const { finish, lastText } = await runToolLoop({
    apiKey, contents, tools, finishName: "finish", temperature: 0.3, debugScope,
    declarations: [...declarations.filter((d) => TOOLS.includes(d.name ?? "")), finishDeclaration],
    systemInstruction: revisePrompt(req.lang, req.trip.language ?? "en", req.trip.currency || "USD"),
  });
  const ids = new Set(req.comments.map((c) => c.id));
  const skipped = Array.isArray(finish?.skippedCommentIds) ? (finish.skippedCommentIds as unknown[]).filter((x) => typeof x === "string") : [];
  // Nothing changed means nothing was applied, whatever the model says.
  const appliedIds = tools.itineraryChanges.length || tools.trip.updatedAt !== req.trip.updatedAt
    ? [...ids].filter((id) => !skipped.includes(id))
    : [];
  const text = typeof finish?.text === "string" && finish.text.trim() ? finish.text.trim() : lastText;
  return { text, appliedIds };
}

/**
 * Offline: each comment goes through the rule-based editor ("add X at 9am on Day 2", "remove X", "move X to Day 3").
 * A comment counts as applied when it changed the itinerary.
 */
export async function offlineRevise(req: ReviseRequest, tools: ToolExecutor): Promise<Revision> {
  const status = tools.trip.status;
  const appliedIds: string[] = [];
  for (const c of req.comments) {
    const before = tools.itineraryChanges.length;
    await handleEdit(c.text, tools);
    if (tools.itineraryChanges.length > before) appliedIds.push(c.id);
  }
  tools.trip = { ...tools.trip, status }; // "looks good" in a comment isn't the owner confirming the trip
  tools.cards = [];
  const n = appliedIds.length;
  const text = req.lang === "vi"
    ? `Đã áp dụng ${n}/${req.comments.length} góp ý.${n < req.comments.length ? " Planner ngoại tuyến chỉ hiểu các yêu cầu như “add X at 9am on Day 2” hoặc “remove X”." : ""}`
    : `Applied ${n} of ${req.comments.length} comments.${n < req.comments.length ? " The offline planner only understands edits like “add X at 9am on Day 2” or “remove X”." : ""}`;
  return { text, appliedIds };
}
