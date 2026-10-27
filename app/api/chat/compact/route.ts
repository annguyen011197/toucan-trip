import { NextResponse } from "next/server";
import type { ChatMessage, Trip } from "@/lib/types";
import { summarizeChat } from "@/lib/engines/summarize";
import { AuthError, verifyRequest } from "@/lib/server/auth";
import { isLang, type Lang } from "@/lib/i18n";
import { debugLog } from "@/lib/debug";

export const runtime = "nodejs";
// Gemini 3 + Google Search can take over a minute; 300s is the Hobby max with Fluid compute.
export const maxDuration = 300;

/** Summarizes messages the client is about to compact. The client swaps them for the summary in Supabase. */
export async function POST(request: Request) {
  try {
    await verifyRequest(request);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Please sign in again" }, { status: 401 });
    throw e;
  }
  let body: { trip: Trip; messages: ChatMessage[]; lang?: Lang };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.trip || !Array.isArray(body.messages) || !body.messages.length) {
    return NextResponse.json({ error: "trip and messages are required" }, { status: 400 });
  }
  try {
    const text = await summarizeChat(body.trip, body.messages.slice(-200), process.env.GEMINI_API_KEY, isLang(body.lang) ? body.lang : "en");
    debugLog("compact", `${body.messages.length} messages → summary`, text);
    return NextResponse.json({ text });
  } catch (e) {
    console.error("[chat/compact]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Compact failed" }, { status: 500 });
  }
}
