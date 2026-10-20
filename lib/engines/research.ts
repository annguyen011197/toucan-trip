import { GoogleGenAI } from "@google/genai";
import type { HotelOffer, HotelQuery, PlaceQuery, PlaceResult } from "../types";
import { LANG_PROMPT_NAME, type Lang } from "../i18n";
import { googleMapsUrl } from "../itinerary-engine";
import { debugLog } from "../debug";

/** Real-world search behind the searchPlaces / searchHotels tools. ToolExecutor falls back to mock data without one. */
export interface Researcher {
  places(q: PlaceQuery): Promise<PlaceResult[]>;
  hotels(q: HotelQuery): Promise<HotelOffer[]>;
}

interface Options { lang: Lang; currency: string; budget?: string; debugScope?: string }

/**
 * A separate Gemini call grounded with Google Search. The planner's own loop can't use the built-in search tool:
 * mixing it with function declarations needs Gemini 3+ (preview), and on 2.5 grounding can't be combined with
 * responseSchema, so the JSON is asked for in the prompt and parsed leniently.
 */
export function geminiResearcher(apiKey: string, opts: Options): Researcher {
  const ai = new GoogleGenAI({ apiKey });
  const scope = `${opts.debugScope ?? "research"} search`;

  async function ask<T>(label: string, prompt: string): Promise<T[]> {
    debugLog(scope, `${label} request`, prompt);
    const started = Date.now();
    const res = await ai.models.generateContent({
      model: process.env.GEMINI_RESEARCH_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { tools: [{ googleSearch: {} }], temperature: 0.2 },
    });
    const meta = res.candidates?.[0]?.groundingMetadata;
    debugLog(scope, `${label} response (${Date.now() - started} ms)`, {
      usage: res.usageMetadata, queries: meta?.webSearchQueries,
      sources: meta?.groundingChunks?.map((c) => c.web?.title), text: res.text,
    });
    return parseArray<T>(res.text ?? "");
  }

  const rules = `Use Google Search. Only include real places that are open today; skip anything permanently closed.
Reply with ONLY a JSON array, no markdown or commentary. Write "note" in ${LANG_PROMPT_NAME[opts.lang]}; keep names as locals and Google Maps show them.
Prices are typical amounts in ${opts.currency} taken from what the search shows; use null when unknown. Give accurate lat/lng.`;

  return {
    async places(q) {
      const rows = await ask<RawPlace>("places", `Find the 4 best ${q.type ?? "places"} for "${q.query}" in or near ${q.near}.
Prefer places with strong recent reviews that locals also go to${opts.budget ? `, fitting a ${opts.budget} budget` : ""}.
${rules}
Fields: {"name","type","address","lat","lng","rating" (Google rating 1-5),"priceLevel" (1-4),"estCost" (per person),"note" (one sentence: what to order or do)}`);
      return rows.filter(validPlace).slice(0, 4).map((p, i) => ({
        placeId: `gs-${slug(p.name)}-${i}`, name: p.name, type: p.type || q.type || "sight", address: p.address,
        lat: p.lat, lng: p.lng, rating: num(p.rating), priceLevel: num(p.priceLevel), estCost: num(p.estCost),
        currency: opts.currency, note: p.note, url: googleMapsUrl({ title: p.name, address: p.address, lat: p.lat, lng: p.lng }, q.near),
      }));
    },
    async hotels(q) {
      const rows = await ask<RawHotel>("hotels", `Find the 3 best-reviewed hotels in ${q.location} for ${q.travelers || 1} traveler(s), ${q.checkIn} to ${q.checkOut}${q.budget ?? opts.budget ? `, ${q.budget ?? opts.budget} budget` : ""}.
Prefer well-located areas for sightseeing.
${rules}
Fields: {"name","area" (neighborhood),"address","lat","lng","rating" (Google rating 1-5),"pricePerNight","note" (one sentence: why stay here)}`);
      return rows.filter(validPlace).slice(0, 3).map((h) => ({
        name: h.name, area: h.area || h.address || q.location, address: h.address, rating: num(h.rating) ?? 0,
        pricePerNight: num(h.pricePerNight) ?? 0, currency: opts.currency, lat: h.lat, lng: h.lng, note: h.note,
        url: googleMapsUrl({ title: h.name, address: h.address, lat: h.lat, lng: h.lng }, q.location),
      }));
    },
  };
}

interface RawPlace { name: string; type?: string; address?: string; lat: number; lng: number; rating?: unknown; priceLevel?: unknown; estCost?: unknown; note?: string }
interface RawHotel { name: string; area?: string; address?: string; lat: number; lng: number; rating?: unknown; pricePerNight?: unknown; note?: string }

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
const validPlace = (p: { name?: unknown; lat?: unknown; lng?: unknown }) =>
  typeof p?.name === "string" && !!p.name.trim() && typeof p.lat === "number" && typeof p.lng === "number";

/** Grounded replies sometimes wrap the JSON in a code fence or a sentence. */
export function parseArray<T>(text: string): T[] {
  const start = text.indexOf("["), end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
