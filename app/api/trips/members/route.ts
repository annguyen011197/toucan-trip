import { NextResponse } from "next/server";
import { AuthError, likeExact, supabaseAdmin, verifyRequest } from "@/lib/server/auth";

export const runtime = "nodejs";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The owner adds someone by email. Server-side (service role) because the owner can't read other
 * people's profiles: an existing account is linked right away, otherwise the invite waits for that
 * email to sign in (/api/auth/sync claims it).
 */
export async function POST(request: Request) {
  let uid: string;
  try {
    uid = (await verifyRequest(request)).uid;
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Please sign in again" }, { status: 401 });
    throw e;
  }
  const body = (await request.json().catch(() => null)) as { tripId?: string; email?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  if (!body?.tripId || !email || !EMAIL.test(email)) return NextResponse.json({ error: "tripId and a valid email are required" }, { status: 400 });

  const db = supabaseAdmin();
  try {
    const { data: trip } = await db.from("trips").select("owner_id").eq("id", body.tripId).maybeSingle();
    if (!trip || trip.owner_id !== uid) return NextResponse.json({ error: "Only the trip owner can invite people" }, { status: 403 });

    const { data: profile } = await db.from("profiles").select("id, display_name").ilike("email", likeExact(email)).limit(1).maybeSingle();
    if (profile?.id === uid) return NextResponse.json({ error: "That's you — you already own this trip" }, { status: 400 });

    const members = () => db.from("trip_members").select("*").eq("trip_id", body.tripId);
    const existing = (await members().eq("email", email).maybeSingle()).data
      ?? (profile ? (await members().eq("user_id", profile.id).maybeSingle()).data : null);
    if (existing) return NextResponse.json({ member: existing, existing: true });

    const { data: member, error } = await db.from("trip_members").insert({
      trip_id: body.tripId, user_id: profile?.id ?? null, email, display_name: profile?.display_name ?? null, invited_by: uid,
    }).select().single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ member, existing: false });
  } catch (e) {
    console.error("[trips/members]", e);
    return NextResponse.json({ error: "Couldn't add that person" }, { status: 500 });
  }
}
