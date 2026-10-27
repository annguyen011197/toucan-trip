import { NextResponse } from "next/server";
import type { CategorizeResponse, ItemCategory, Trip } from "@/lib/types";
import { geminiCategorize, offlineCategorize, type CategorizeItem } from "@/lib/engines/categorize";
import { AuthError, supabaseAdmin, verifyRequest } from "@/lib/server/auth";
import { debugId, debugLog } from "@/lib/debug";

export const runtime = "nodejs";
// Gemini 3 + Google Search can take over a minute; 300s is the Hobby max with Fluid compute.
export const maxDuration = 300;

/**
 * Owner re-categorizes every expense of a trip. Runs with the service role because members' rows are only
 * updatable by their authors under RLS; ownership is checked here instead. Clients pick up changes via Realtime.
 */
export async function POST(request: Request) {
  let uid: string;
  try {
    uid = (await verifyRequest(request)).uid;
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Please sign in again" }, { status: 401 });
    throw e;
  }
  const { tripId } = ((await request.json().catch(() => ({}))) ?? {}) as { tripId?: string };
  if (typeof tripId !== "string" || !/^[0-9a-f-]{36}$/i.test(tripId)) return NextResponse.json({ error: "tripId is required" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: trip, error: tripError } = await db.from("trips").select("owner_id, itinerary").eq("id", tripId).maybeSingle();
  if (tripError) return NextResponse.json({ error: tripError.message }, { status: 500 });
  if (!trip || trip.owner_id !== uid) return NextResponse.json({ error: "Only the trip owner can do this" }, { status: 403 });

  const { data: rows, error } = await db.from("trip_expenses").select("id, title, note, category, item_id").eq("trip_id", tripId).limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const stops = new Map((trip.itinerary as Trip["itinerary"]).flatMap((d) => d.items.map((i) => [i.id, i.title] as const)));
  const items: CategorizeItem[] = (rows ?? []).map((r) => ({ id: r.id, title: r.title, note: r.note ?? "", category: r.category, stop: r.item_id ? stops.get(r.item_id) : undefined }));
  if (!items.length) return NextResponse.json({ changed: [], total: 0, engine: "offline" } satisfies CategorizeResponse);

  const apiKey = process.env.GEMINI_API_KEY;
  const scope = `categorize ${debugId()}`;
  let engine: CategorizeResponse["engine"] = apiKey ? "gemini" : "offline";
  let picked: Record<string, ItemCategory>;
  try {
    picked = apiKey ? await geminiCategorize(items, apiKey, scope) : offlineCategorize(items);
  } catch (e) {
    // A Gemini outage shouldn't leave the button dead; keywords still fix the obvious ones.
    console.error("[expenses/categorize]", e);
    picked = offlineCategorize(items);
    engine = "offline";
  }

  const changed = items.filter((i) => picked[i.id] && picked[i.id] !== i.category).map((i) => ({ id: i.id, title: i.title, from: i.category, to: picked[i.id] }));
  // One update per target category.
  const byCategory = new Map<ItemCategory, string[]>();
  for (const c of changed) byCategory.set(c.to, [...(byCategory.get(c.to) ?? []), c.id]);
  for (const [category, ids] of byCategory) {
    const { error: e } = await db.from("trip_expenses").update({ category }).eq("trip_id", tripId).in("id", ids);
    if (e) return NextResponse.json({ error: e.message }, { status: 500 });
  }
  debugLog(scope, `done (${engine})`, { total: items.length, changed });
  return NextResponse.json({ changed, total: items.length, engine } satisfies CategorizeResponse);
}
