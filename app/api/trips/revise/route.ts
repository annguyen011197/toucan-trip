import { NextResponse } from "next/server";
import type { ReviseRequest, ReviseResponse } from "@/lib/types";
import { ToolExecutor } from "@/lib/tools";
import { geminiRevise, offlineRevise } from "@/lib/engines/revise";
import { AuthError, verifyRequest } from "@/lib/server/auth";
import { addPlaceImages } from "@/lib/server/place-images";
import { isLang } from "@/lib/i18n";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The owner applies approved comments to the whole itinerary with AI. Stateless like /api/chat:
 * returns the revised trip and which comments were applied; the client persists both (RLS keeps
 * saving the trip and marking comments owner-only).
 */
export async function POST(request: Request) {
  try {
    await verifyRequest(request);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Please sign in again" }, { status: 401 });
    throw e;
  }
  let body: ReviseRequest;
  try {
    body = (await request.json()) as ReviseRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.trip || !Array.isArray(body.comments) || !body.comments.length) {
    return NextResponse.json({ error: "trip and comments are required" }, { status: 400 });
  }
  body.comments = body.comments.slice(0, 50).map((c) => ({ ...c, text: String(c.text ?? "").slice(0, 2000) }));
  if (!isLang(body.lang)) body.lang = "en";

  const apiKey = process.env.GEMINI_API_KEY;
  try {
    const tools = new ToolExecutor(body.trip, body.lang);
    const { text, appliedIds } = apiKey ? await geminiRevise(body, tools, apiKey) : await offlineRevise(body, tools);
    const res: ReviseResponse = {
      text,
      trip: await addPlaceImages(tools.trip),
      itineraryChanges: tools.itineraryChanges,
      appliedIds,
      engine: apiKey ? "gemini" : "offline",
    };
    return NextResponse.json(res);
  } catch (e) {
    console.error("[trips/revise]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Revise failed" }, { status: 500 });
  }
}
