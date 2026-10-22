import { NextResponse } from "next/server";
import type { ExpenseSplit } from "@/lib/types";
import { rekeyExpense } from "@/lib/expenses";
import { AuthError, supabaseAdmin, verifyRequest } from "@/lib/server/auth";

export const runtime = "nodejs";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Owner links a virtual traveler to a real member who joined the trip: the traveler row gets the member's
 * user id and every expense the virtual traveler paid or shared moves to the member. Service role, because
 * expense rows are only updatable by their authors under RLS; ownership and membership are checked here.
 */
export async function POST(request: Request) {
  let uid: string;
  try {
    uid = (await verifyRequest(request)).uid;
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Please sign in again" }, { status: 401 });
    throw e;
  }
  const { travelerId, userId } = ((await request.json().catch(() => ({}))) ?? {}) as { travelerId?: string; userId?: string };
  if (typeof travelerId !== "string" || !UUID.test(travelerId) || typeof userId !== "string" || !userId) {
    return NextResponse.json({ error: "travelerId and userId are required" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: traveler } = await db.from("trip_travelers").select("id, trip_id, user_id, name").eq("id", travelerId).maybeSingle();
  if (!traveler) return NextResponse.json({ error: "Traveler not found" }, { status: 404 });
  if (traveler.user_id) return NextResponse.json({ error: "Already linked" }, { status: 409 });
  const { data: trip } = await db.from("trips").select("owner_id").eq("id", traveler.trip_id).maybeSingle();
  if (!trip || trip.owner_id !== uid) return NextResponse.json({ error: "Only the trip owner can do this" }, { status: 403 });
  const { data: member } = await db.from("trip_members").select("user_id, display_name, email")
    .eq("trip_id", traveler.trip_id).eq("user_id", userId).maybeSingle();
  if (!member && userId !== trip.owner_id) return NextResponse.json({ error: "That person isn't a member of this trip" }, { status: 400 });

  const name = member?.display_name || member?.email?.split("@")[0] || traveler.name;
  const from = `traveler:${traveler.id}`;
  const to = { key: userId, name };

  // Rewrite expenses first: if this fails, the traveler stays virtual and nothing is half-moved in the UI.
  const { data: rows, error } = await db.from("trip_expenses").select("id, paid_by, paid_by_name, split").eq("trip_id", traveler.trip_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let moved = 0;
  for (const r of rows ?? []) {
    const next = rekeyExpense({
      paidBy: r.paid_by ? { key: r.paid_by, name: r.paid_by_name ?? "" } : undefined,
      split: (r.split as ExpenseSplit | null) ?? undefined,
    }, from, to);
    if (!next) continue;
    const { error: e } = await db.from("trip_expenses").update({
      paid_by: next.paidBy?.key ?? null, paid_by_name: next.paidBy?.name ?? "", split: next.split ?? null,
    }).eq("id", r.id);
    if (e) return NextResponse.json({ error: e.message }, { status: 500 });
    moved++;
  }

  // The member (or the owner, who is implicit) may already be on the list; then the virtual row just goes away.
  const { data: existing } = await db.from("trip_travelers").select("id").eq("trip_id", traveler.trip_id).eq("user_id", userId).maybeSingle();
  const { error: e2 } = existing || userId === trip.owner_id
    ? await db.from("trip_travelers").delete().eq("id", traveler.id)
    : await db.from("trip_travelers").update({ user_id: userId, name }).eq("id", traveler.id);
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
  return NextResponse.json({ moved });
}
