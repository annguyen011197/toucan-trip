import { GoogleGenAI, Type, FunctionCallingConfigMode, type Content, type FunctionDeclaration, type Part, type Schema } from "@google/genai";
import type { ChatRequest, UserProfile } from "../types";
import { BUDGET_LABEL, ITEM_CATEGORIES } from "../types";
import { ToolExecutor, snapshot } from "../tools";
import { toISODate } from "../time";
import type { BotTurn } from "./mock";
import { LANG_PROMPT_NAME, type Lang } from "../i18n";

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
3. When destination, dates and interests are known and the itinerary is empty, generate a draft itinerary with ONE updateItinerary call (3-5 items per day, realistic 24h "HH:mm" times, accurate lat/lng, address, category, estCost in ${currency} per person), then ask what to adjust.
4. Apply edits the user asks for (e.g. "add Kinkaku-ji at 9am on Day 2") with updateItinerary. Use itemId from the trip state for remove/move/edit.
5. Offer flights, hotels and restaurants with searchFlights / searchHotels / searchPlaces. The app shows their results as cards automatically — don't repeat prices in your text.
6. When the user confirms the plan, call updateTripInfo with status "upcoming".

Rules:
- Never invent prices, availability, flight numbers or ratings. They may only come from tool results.
- Dates are "yyyy-MM-dd". Times are 24h "HH:mm".
- ALWAYS end every turn by calling \`reply\` with your message and 2-4 short quick replies (chips) whenever choices make sense.
- Write \`reply\` text and quick replies in ${LANG_PROMPT_NAME[lang]}.
- Write itinerary item titles, notes and tags in ${LANG_PROMPT_NAME[tripLang]} (the language of this trip's plan), and every estCost in ${currency}.

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
    note: S("One-line tip"),
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

export async function geminiRespond(req: ChatRequest, tools: ToolExecutor, apiKey: string): Promise<BotTurn> {
  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

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

  let lastText = "";
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: systemPrompt(req.profile, req.lang, req.trip.language ?? "en", req.trip.currency || "USD"),
        tools: [{ functionDeclarations: declarations }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } },
        temperature: 0.7,
      },
    });
    const calls = res.functionCalls ?? [];
    if (!calls.length) { lastText = res.text ?? ""; break; }

    const modelContent = res.candidates?.[0]?.content;
    if (modelContent) contents.push(modelContent);

    let finalTurn: BotTurn | undefined;
    const parts: Part[] = [];
    for (const call of calls) {
      const name = call.name ?? "";
      if (name === "reply") {
        finalTurn = parseReply(call.args);
        parts.push({ functionResponse: { id: call.id, name, response: { ok: true } } });
        continue;
      }
      let output: Record<string, unknown>;
      try {
        output = await tools.execute(name, call.args ?? {});
      } catch (e) {
        output = { error: e instanceof Error ? e.message : String(e) };
      }
      parts.push({ functionResponse: { id: call.id, name, response: output } });
    }
    if (finalTurn) return finalTurn;
    contents.push({ role: "user", parts });
  }
  return { text: lastText || "Hmm, my compass spun for a second — could you say that again?", quickReplies: [] };
}
