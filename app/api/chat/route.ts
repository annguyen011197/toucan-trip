import { NextResponse } from "next/server";
import type { ChatRequest, ChatResponse } from "@/lib/types";
import { ToolExecutor } from "@/lib/tools";
import { mockRespond } from "@/lib/engines/mock";
import { geminiRespond } from "@/lib/engines/gemini";
import { AuthError, verifyRequest } from "@/lib/server/auth";
import { addPlaceImages } from "@/lib/server/place-images";

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

  const tools = new ToolExecutor(body.trip);
  const apiKey = process.env.GEMINI_API_KEY;
  try {
    const turn = apiKey ? await geminiRespond(body, tools, apiKey) : await mockRespond(body, tools);
    const res: ChatResponse = {
      text: turn.text,
      quickReplies: turn.quickReplies,
      cards: tools.cards,
      trip: await addPlaceImages(tools.trip),
      itineraryChanges: tools.itineraryChanges,
      engine: apiKey ? "gemini" : "offline",
    };
    return NextResponse.json(res);
  } catch (e) {
    console.error("[chat]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Chat failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ engine: process.env.GEMINI_API_KEY ? "gemini" : "offline" });
}
