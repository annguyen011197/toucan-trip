import { NextResponse } from "next/server";
import type { ConvertRequest } from "@/lib/types";
import { CURRENCIES, convertTripCosts } from "@/lib/currency";
import { isLang } from "@/lib/i18n";
import { translateTrip } from "@/lib/engines/translate";
import { exchangeRate } from "@/lib/server/rates";
import { AuthError, verifyRequest } from "@/lib/server/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Converts a trip to another language and/or currency and returns it; the client persists it.
 * Translation needs Gemini; currency conversion works offline (with fallback rates).
 */
export async function POST(request: Request) {
  try {
    await verifyRequest(request);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Please sign in again" }, { status: 401 });
    throw e;
  }
  let body: ConvertRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.trip || !isLang(body.language) || !(CURRENCIES as readonly string[]).includes(body.currency)) {
    return NextResponse.json({ error: "trip, language and currency are required" }, { status: 400 });
  }
  let trip = body.trip;
  try {
    if ((trip.language ?? "en") !== body.language) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return NextResponse.json({ error: "Translating needs the Gemini planner (GEMINI_API_KEY)" }, { status: 503 });
      trip = { ...(await translateTrip(trip, body.language, apiKey)), language: body.language };
    }
    if (trip.currency !== body.currency) {
      trip = convertTripCosts(trip, body.currency, await exchangeRate(trip.currency, body.currency));
    }
    return NextResponse.json({ trip: { ...trip, updatedAt: Date.now() } });
  } catch (e) {
    console.error("[trips/convert]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Convert failed" }, { status: 500 });
  }
}
