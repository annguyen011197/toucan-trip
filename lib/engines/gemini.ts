import { GoogleGenAI, Type, FunctionCallingConfigMode, type Content, type FunctionDeclaration, type Part, type Schema } from "@google/genai";
import type { ChatRequest, UserProfile } from "../types";
import { BUDGET_LABEL, ITEM_CATEGORIES } from "../types";
import { ToolExecutor, snapshot } from "../tools";
import { toISODate } from "../time";
import type { BotTurn } from "./mock";
import { LANG_PROMPT_NAME, type Lang } from "../i18n";
import { debugLog } from "../debug";

/**
 * Gemini with function calling. Runs only on the server (API route), so GEMINI_API_KEY never reaches the browser.
 *
 * Turn protocol:
 *  1. Stateless: history comes from the client + a JSON snapshot of the trip (with item ids).
 *  2. The model calls tools (updateTripInfo, updateItinerary, search*) → ToolExecutor runs them.
 *  3. The model finishes by calling `reply(text, quickReplies)` → structured { text, quickReplies }.
 *     Cards come from search tool results, never from the model, so prices can't be invented.
 */
const MAX_ROUNDS = 6;

export function systemPrompt(profile: UserProfile, lang: Lang = "en", tripLang: Lang = "en", currency = "USD"): string {
  return `You are "Travel AI", a friendly toucan travel planner inside the Toucan Trip app.
Persona: warm, lightly playful (an occasional bird pun or 🐦 is fine), concise — 1-3 short sentences per reply.

Follow this flow, using the [trip state] JSON to see what is already known:
1. Ask for the destination. If the user has none, suggest 2-3 options based on vibe, season, and budget.
2. Collect origin, dates, travelers, budget and interests — one or two questions per turn. Save each answer with updateTripInfo as soon as you get it.
3. When destination, dates and interests are known and the itinerary is empty, generate a draft itinerary with ONE updateItinerary call (3-5 items per day, realistic 24h "HH:mm" times, accurate lat/lng, address, category, note, tips, estCost in ${currency} per person), then ask what to adjust.
4. Apply edits the user asks for (e.g. "add Kinkaku-ji at 9am on Day 2") with updateItinerary. Use itemId from the trip state for remove/move/edit.
5. Offer flights, hotels and restaurants with searchFlights / searchHotels / searchPlaces. The app shows their results as cards automatically — don't repeat prices in your text.
   searchPlaces / searchHotels return real places from Google Search: make "query" specific (cuisine, dish, vibe, diet, area — e.g. "authentic bún chả near Hoan Kiem" rather than "restaurant"),
   and when adding one of them to the itinerary reuse its name, address and lat/lng exactly.
6. When the user confirms the plan, call updateTripInfo with status "upcoming".
7. If the user asks for tips, what to wear or what to pack, add tips to the stops that lack them (hasTips: false) with "edit" ops, then sum up the trip-wide essentials in your reply.

Stop notes and tips (every stop you add or replace gets both):
- note: one sentence on why it's worth it or what to do there (the signature dish, the best viewpoint, the must-see room).
- tips: 2-4 short, practical, place-specific items the traveler acts on before or at the stop. Cover what applies:
  · What to wear: dress codes (covered shoulders/knees at temples, no shoes indoors), footwear for hikes, steps or wet ground, layers for wind, AC or altitude.
  · What to bring: cash (and whether cards work), passport/ID, water, sunscreen, hat, raincoat, swimwear, towel, bug spray, charger, a bag for shoes.
  · Booking: reserve or buy tickets ahead, the queue to beat, closing days, last entry.
  · Timing and conditions: the best hour to avoid crowds or heat, the weather in that season (use the trip dates), sunset times.
  · Etiquette and safety: photo rules, tipping, bargaining, scams or pickpockets, ID checks at bars.
- Make tips specific to this place and season ("Shoulders and knees covered — sarongs at the gate cost extra"), never generic filler like "Have fun" or "Check opening hours".
- Each tip is one short phrase, under ~15 words, with no prices (estCost already carries the cost).

Rules:
- Never invent prices, availability, flight numbers or ratings. They may only come from tool results.
- Dates are "yyyy-MM-dd". Times are 24h "HH:mm".
- Itinerary items may have status "done" (already visited) or "skipped" (dropped during the trip). Keep them as they are; don't re-add, move or re-suggest them unless the user asks.
- ALWAYS end every turn by calling \`reply\` with your message and 2-4 short quick replies (chips) whenever choices make sense.
- Write \`reply\` text and quick replies in ${LANG_PROMPT_NAME[lang]}.
- Write itinerary item titles, notes, tips and tags in ${LANG_PROMPT_NAME[tripLang]} (the language of this trip's plan), and every estCost in ${currency}.

User profile (personalize with it):
- Name: ${profile.name || "unknown"}
- Interests: ${profile.interests.join(", ")}
- Budget level: ${BUDGET_LABEL[profile.budgetLevel]}
- Pace: ${profile.pace}
- Diet: ${profile.diet}
- Home airport: ${profile.homeAirport || "unknown (ask)"}`;
}

const S = (description?: string): Schema => ({ type: Type.STRING, description });

const itemSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    id: S("Existing item id (edit/move/remove)"),
    time: S("24h HH:mm"),
    title: S("Place or activity name"),
    placeId: S(),
    address: S("Street address or neighborhood of the place, e.g. \"1 Kinkakujicho, Kita Ward, Kyoto\""),
    lat: { type: Type.NUMBER },
    lng: { type: Type.NUMBER },
    note: S("One sentence: why go and what to do there"),
    tips: { type: Type.ARRAY, items: S(), description: "2-4 short practical tips: what to wear, what to bring, book ahead, best time, etiquette" },
    category: { type: Type.STRING, enum: ITEM_CATEGORIES },
    estCost: { type: Type.NUMBER, description: "Estimated cost per person, in the trip's currency" },
  },
};

export const declarations: FunctionDeclaration[] = [
  {
    name: "updateTripInfo",
    description: "Save trip details the user provided.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        destination: S("City, Country"),
        origin: S("Origin airport IATA code or city"),
        startDate: S("yyyy-MM-dd"),
        endDate: S("yyyy-MM-dd"),
        travelers: { type: Type.INTEGER },
        budget: S("Budget, Mid-range, Luxury or an amount"),
        interests: { type: Type.ARRAY, items: S() },
        status: { type: Type.STRING, enum: ["dreaming", "upcoming"], description: "Set to upcoming when the user confirms" },
      },
    },
  },
  {
    name: "updateItinerary",
    description: "Add, remove, move or edit itinerary items. The itinerary is the single source of truth.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        ops: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              action: { type: Type.STRING, enum: ["add", "remove", "move", "edit"] },
              day: { type: Type.INTEGER, description: "1-based day number" },
              item: itemSchema,
              itemId: S("Target item id from the trip state"),
              toDay: { type: Type.INTEGER, description: "Destination day for move" },
            },
            required: ["action", "day"],
          },
        },
      },
      required: ["ops"],
    },
  },
  {
    name: "searchFlights",
    description: "Search flights. Returns offers with prices.",
    parameters: {
      type: Type.OBJECT,
      properties: { origin: S(), destination: S("IATA code or city"), date: S("yyyy-MM-dd"), returnDate: S("yyyy-MM-dd"), travelers: { type: Type.INTEGER } },
      required: ["origin", "destination", "date", "travelers"],
    },
  },
  {
    name: "searchHotels",
    description: "Search hotels. Returns offers with nightly prices.",
    parameters: {
      type: Type.OBJECT,
      properties: { location: S(), checkIn: S("yyyy-MM-dd"), checkOut: S("yyyy-MM-dd"), travelers: { type: Type.INTEGER }, budget: S() },
      required: ["location", "checkIn", "checkOut", "travelers"],
    },
  },
  {
    name: "searchPlaces",
    description: "Search places (restaurants, sights, activities) near a location. Returns coordinates.",
    parameters: {
      type: Type.OBJECT,
      properties: { query: S(), near: S(), type: S("restaurant, sight, activity, shopping, nightlife") },
      required: ["query", "near"],
    },
  },
  {
    name: "reply",
    description: "Send the final message for this turn. Always call this last.",
    parameters: {
      type: Type.OBJECT,
      properties: { text: S("Message to the user"), quickReplies: { type: Type.ARRAY, items: S(), description: "2-4 short chip labels" } },
      required: ["text"],
    },
  },
];

function parseReply(args: Record<string, unknown> | undefined): BotTurn {
  const text = typeof args?.text === "string" ? args.text : "";
  const chips = Array.isArray(args?.quickReplies) ? (args!.quickReplies as unknown[]).filter((x): x is string => typeof x === "string") : [];
  return { text, quickReplies: chips.slice(0, 4) };
}

export async function geminiRespond(req: ChatRequest, tools: ToolExecutor, apiKey: string, debugScope = "chat"): Promise<BotTurn> {
  const contents: Content[] = req.history
    .filter((m) => m.type !== "itineraryUpdate" && m.text.trim())
    .slice(-30)
    .map((m): Content => m.type === "summary"
      ? { role: "user", parts: [{ text: `[summary of our earlier conversation]\n${m.text}` }] }
      : { role: m.role === "user" ? "user" : "model", parts: [{ text: m.text }] });
  contents.push({
    role: "user",
    parts: [{ text: `[today: ${toISODate(new Date())}]\n[trip state]\n${JSON.stringify(snapshot(tools.trip))}\n\n[user]\n${req.text}` }],
  });
  const { finish, lastText } = await runToolLoop({
    apiKey, contents, tools, declarations, finishName: "reply", temperature: 0.7, debugScope,
    systemInstruction: systemPrompt(req.profile, req.lang, req.trip.language ?? "en", req.trip.currency || "USD"),
  });
  if (finish) return parseReply(finish);
  return { text: lastText || "Hmm, my compass spun for a second — could you say that again?", quickReplies: [] };
}

/**
 * Lets the model call `declarations` (run by ToolExecutor) until it calls `finishName`, whose args are returned.
 * Without a finishing call, returns the model's last plain text.
 */
export async function runToolLoop(opts: {
  apiKey: string; systemInstruction: string; contents: Content[]; tools: ToolExecutor;
  declarations: FunctionDeclaration[]; finishName: string; temperature: number; debugScope?: string;
}): Promise<{ finish?: Record<string, unknown>; lastText: string }> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const contents = [...opts.contents];
  const scope = opts.debugScope ?? "gemini";
  debugLog(scope, `system prompt (${model}, temperature ${opts.temperature})`, opts.systemInstruction);
  debugLog(scope, "contents", opts.contents);

  let lastText = "";
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const started = Date.now();
    const res = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: opts.systemInstruction,
        tools: [{ functionDeclarations: opts.declarations }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } },
        temperature: opts.temperature,
      },
    });
    const calls = res.functionCalls ?? [];
    debugLog(scope, `round ${round + 1} response (${Date.now() - started} ms)`, {
      finishReason: res.candidates?.[0]?.finishReason,
      usage: res.usageMetadata,
      functionCalls: calls.map((c) => ({ name: c.name, args: c.args })),
      text: calls.length ? undefined : res.text,
    });
    if (!calls.length) { lastText = res.text ?? ""; break; }

    const modelContent = res.candidates?.[0]?.content;
    if (modelContent) contents.push(modelContent);

    let finish: Record<string, unknown> | undefined;
    const parts: Part[] = [];
    for (const call of calls) {
      const name = call.name ?? "";
      if (name === opts.finishName) {
        finish = call.args ?? {};
        parts.push({ functionResponse: { id: call.id, name, response: { ok: true } } });
        continue;
      }
      let output: Record<string, unknown>;
      try {
        output = await opts.tools.execute(name, call.args ?? {});
      } catch (e) {
        output = { error: e instanceof Error ? e.message : String(e) };
      }
      parts.push({ functionResponse: { id: call.id, name, response: output } });
    }
    if (finish) return { finish, lastText };
    debugLog(scope, `round ${round + 1} tool results`, parts.map((p) => p.functionResponse));
    contents.push({ role: "user", parts });
  }
  debugLog(scope, `ended without calling ${opts.finishName}`);
  return { lastText };
}
