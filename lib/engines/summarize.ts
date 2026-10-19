import { GoogleGenAI } from "@google/genai";
import type { ChatMessage, Trip } from "../types";
import { LANG_PROMPT_NAME, type Lang } from "../i18n";

const MAX_WORDS = 120;

const transcript = (messages: ChatMessage[]) =>
  messages
    .filter((m) => m.text.trim())
    .map((m) => (m.type === "summary" ? `[earlier summary] ${m.text}` : `${m.role === "user" ? "Traveler" : "Travel AI"}: ${m.text}`))
    .join("\n");

/** Short memory of the conversation. The itinerary itself lives on the trip, so it isn't repeated here. */
export async function summarizeChat(trip: Trip, messages: ChatMessage[], apiKey?: string, lang: Lang = "en"): Promise<string> {
  if (!apiKey) return offlineSummary(trip, messages);
  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: transcript(messages) }] }],
    config: {
      systemInstruction:
        `Summarize this travel-planning chat so the assistant can continue it later. Trip: ${trip.title}` +
        `${trip.destination ? ` to ${trip.destination}` : ""}. Keep the traveler's preferences, decisions, constraints and open questions. ` +
        `Don't list the itinerary stops (they're stored separately). Plain text in ${LANG_PROMPT_NAME[lang]}, at most ${MAX_WORDS} words, second person ("You…").`,
      temperature: 0.2,
    },
  });
  return res.text?.trim() || offlineSummary(trip, messages);
}

function offlineSummary(trip: Trip, messages: ChatMessage[]): string {
  const previous = messages.find((m) => m.type === "summary")?.text;
  const asks = messages.filter((m) => m.role === "user").map((m) => m.text.replace(/\s+/g, " ").trim()).filter(Boolean);
  const updates = messages.filter((m) => m.type === "itineraryUpdate").reduce((n, m) => n + (m.cards[0]?.changes?.length ?? 0), 0);
  const parts = [
    previous,
    asks.length ? `You asked: ${asks.slice(-8).map((a) => `“${a.length > 80 ? a.slice(0, 77) + "…" : a}”`).join(", ")}.` : undefined,
    updates ? `${updates} itinerary change${updates === 1 ? "" : "s"} were made.` : undefined,
  ].filter(Boolean);
  return parts.join(" ") || `Earlier chat about ${trip.destination ?? trip.title}.`;
}
