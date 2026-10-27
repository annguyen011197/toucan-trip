import { geminiModel } from "./model";
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import type { Trip } from "../types";
import { LANG_PROMPT_NAME, type Lang } from "../i18n";
import { debugLog } from "../debug";

interface TextItem { id: string; title: string; note: string; tips?: string[]; tags?: string[] }
interface Payload { title: string; items: TextItem[] }

const schema: Schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { id: { type: Type.STRING }, title: { type: Type.STRING }, note: { type: Type.STRING }, tips: { type: Type.ARRAY, items: { type: Type.STRING } }, tags: { type: Type.ARRAY, items: { type: Type.STRING } } },
        required: ["id", "title", "note"],
      },
    },
  },
  required: ["title", "items"],
};

/** Translates the trip's human-readable text (title, stop names, notes, tips, tags). Ids, times, places and costs are untouched. */
export async function translateTrip(trip: Trip, to: Lang, apiKey: string): Promise<Trip> {
  const payload: Payload = {
    title: trip.title,
    items: trip.itinerary.flatMap((d) => d.items.map((i) => ({ id: i.id, title: i.title, note: i.note, tips: i.tips, tags: i.tags }))),
  };
  const ai = new GoogleGenAI({ apiKey });
  debugLog("translate", `request → ${to}`, payload);
  const started = Date.now();
  const res = await ai.models.generateContent({
    model: geminiModel(),
    contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
    config: {
      systemInstruction:
        `Translate this travel itinerary JSON into ${LANG_PROMPT_NAME[to]}. Translate "title", every item's "title", "note", "tips" and "tags". ` +
        `Keep "id" unchanged and return every item. For place names use the name a ${LANG_PROMPT_NAME[to]}-speaking traveler would search for ` +
        `(keep well-known proper nouns, e.g. "Kinkaku-ji" → "Chùa Kinkaku-ji"). Keep emoji. Keep the tone short and friendly.`,
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0.2,
    },
  });
  debugLog("translate", `response (${Date.now() - started} ms)`, { usage: res.usageMetadata, text: res.text });
  const out = JSON.parse(res.text ?? "{}") as Partial<Payload>;
  const byId = new Map((out.items ?? []).map((i) => [i.id, i]));
  return {
    ...trip,
    title: out.title?.trim() || trip.title,
    itinerary: trip.itinerary.map((d) => ({
      ...d,
      items: d.items.map((i) => {
        const t = byId.get(i.id);
        if (!t) return i;
        return { ...i, title: t.title?.trim() || i.title, note: t.note ?? i.note, tips: i.tips && t.tips?.length ? t.tips : i.tips, tags: i.tags && t.tags?.length ? t.tags : i.tags };
      }),
    })),
  };
}
