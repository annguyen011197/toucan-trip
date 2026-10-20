import { NextResponse } from "next/server";
import type { ChatRequest, ChatResponse } from "@/lib/types";
import { ToolExecutor } from "@/lib/tools";
import { geminiResearcher } from "@/lib/engines/research";
import { mockRespond } from "@/lib/engines/mock";
import { geminiRespond } from "@/lib/engines/gemini";
import { AuthError, verifyRequest } from "@/lib/server/auth";
import { addPlaceImages } from "@/lib/server/place-images";
import { exchangeRate } from "@/lib/server/rates";
import { isLang } from "@/lib/i18n";
import { debugId, debugLog } from "@/lib/debug";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * One bot turn. Stateless: the client sends the trip + recent history, we run the engine
 * (Gemini if GEMINI_API_KEY is set, otherwise the offline Travel AI) and return the updated trip.
 * Requires a Firebase ID token so only signed-in users can spend model quota.
 * The client persists it — the itinerary stays the single source of truth in the store.
 */
export async function POST(request: Request) {
  try {
    await verifyRequest(request);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Please sign in again" }, { status: 401 });
    throw e;
  }
  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.trip || typeof body.text !== "string" || !body.text.trim()) {
    return NextResponse.json({ error: "trip and text are required" }, { status: 400 });
  }
  body.text = body.text.slice(0, 2000);
  body.history = Array.isArray(body.history) ? body.history.slice(-40) : [];
  if (!isLang(body.lang)) body.lang = "en";

  const apiKey = process.env.GEMINI_API_KEY;
  const scope = `chat ${debugId()}`;
  const started = Date.now();
  debugLog(scope, `request (${apiKey ? "gemini" : "offline"})`, {
    text: body.text, lang: body.lang, history: body.history.length,
    trip: { id: body.trip.id, destination: body.trip.destination, currency: body.trip.currency, language: body.trip.language, days: body.trip.itinerary?.length },
  });
  try {
    // Gemini prices in the trip's currency; the offline engine's sample data is in USD.
    const costScale = apiKey || !body.trip.currency || body.trip.currency === "USD" ? 1 : await exchangeRate("USD", body.trip.currency);
    const tools = new ToolExecutor(body.trip, body.lang, costScale);
    if (apiKey) tools.research = geminiResearcher(apiKey, { lang: body.lang, currency: body.trip.currency || "USD", budget: body.trip.budget, debugScope: scope });
    const turn = apiKey ? await geminiRespond(body, tools, apiKey, scope) : await mockRespond(body, tools);
    const res: ChatResponse = {
      text: turn.text,
      quickReplies: turn.quickReplies,
      cards: tools.cards,
      trip: await addPlaceImages(tools.trip),
      itineraryChanges: tools.itineraryChanges,
      engine: apiKey ? "gemini" : "offline",
    };
    debugLog(scope, `response (${Date.now() - started} ms)`, { ...res, trip: undefined, itinerary: res.trip.itinerary });
    return NextResponse.json(res);
  } catch (e) {
    console.error("[chat]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Chat failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ engine: process.env.GEMINI_API_KEY ? "gemini" : "offline" });
}
