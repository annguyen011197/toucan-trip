import { geminiModel } from "./model";
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { ITEM_CATEGORIES, type ItemCategory } from "../types";
import { guessCategory, isItemCategory } from "../expenses";
import { debugLog } from "../debug";

export interface CategorizeItem { id: string; title: string; note: string; category: ItemCategory; /** Title of the linked stop, if any. */ stop?: string }

const schema: Schema = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { id: { type: Type.STRING }, category: { type: Type.STRING, enum: [...ITEM_CATEGORIES] } },
        required: ["id", "category"],
      },
    },
  },
  required: ["items"],
};

const PROMPT =
  "You categorize travel expenses. For every item return its id and the best category:\n" +
  "food = meals, snacks, coffee, groceries for eating; sight = entrance tickets to sights, museums, temples, parks; " +
  "activity = tours, classes, spa/massage, shows, outdoor activities; transport = taxis, ride-hailing, trains, buses, flights, fuel, parking, transit cards; " +
  "hotel = accommodation; shopping = souvenirs, clothes, pharmacy, SIM cards, other goods; nightlife = bars, clubs, alcohol, karaoke; other = anything else (fees, insurance, tips).\n" +
  "Titles may be Vietnamese, English or mixed. Use the note and the linked stop as context. Return every id exactly once.";

/** Gemini picks a category per expense; anything it skips or garbles keeps its current one. */
export async function geminiCategorize(items: CategorizeItem[], apiKey: string, scope: string): Promise<Record<string, ItemCategory>> {
  const ai = new GoogleGenAI({ apiKey });
  const out: Record<string, ItemCategory> = {};
  // Batches keep each response well inside the output limit.
  for (let i = 0; i < items.length; i += 150) {
    const batch = items.slice(i, i + 150).map(({ id, title, note, stop }) => ({ id, title, note: note || undefined, stop }));
    debugLog(scope, "gemini request", batch);
    const res = await ai.models.generateContent({
      model: geminiModel(),
      contents: [{ role: "user", parts: [{ text: JSON.stringify(batch) }] }],
      config: { systemInstruction: PROMPT, responseMimeType: "application/json", responseSchema: schema, temperature: 0 },
    });
    debugLog(scope, "gemini response", { usage: res.usageMetadata, text: res.text });
    const parsed = JSON.parse(res.text ?? "{}") as { items?: { id?: string; category?: string }[] };
    for (const r of parsed.items ?? []) if (r.id && isItemCategory(r.category)) out[r.id] = r.category;
  }
  return out;
}

export function offlineCategorize(items: CategorizeItem[]): Record<string, ItemCategory> {
  return Object.fromEntries(items.map((i) => [i.id, guessCategory([i.title, i.note, i.stop].filter(Boolean).join(" "), i.category)]));
}
