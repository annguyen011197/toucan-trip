import { NextResponse } from "next/server";
import { AuthError, supabaseAdmin, verifyRequest } from "@/lib/server/auth";

export const runtime = "nodejs";

/** Opening a share link (`/?join=<token>`) while signed in makes the user a commenter on that trip. */
export async function POST(request: Request) {
  let user;
  try {
    user = await verifyRequest(request);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Please sign in again" }, { status: 401 });
    throw e;
  }
  const body = (await request.json().catch(() => null)) as { token?: string } | null;
  if (!body?.token || typeof body.token !== "string") return NextResponse.json({ error: "token is required" }, { status: 400 });

  const db = supabaseAdmin();
  try {
    const { data: link } = await db.from("trip_share_links").select("trip_id, trips(owner_id)").eq("token", body.token).maybeSingle();
    if (!link) return NextResponse.json({ error: "This share link is invalid or was turned off" }, { status: 404 });
    const tripId = link.trip_id as string;
    const ownerId = (link.trips as unknown as { owner_id: string } | null)?.owner_id;
    if (ownerId === user.uid) return NextResponse.json({ tripId, role: "owner" });

    const { data: mine } = await db.from("trip_members").select("id").eq("trip_id", tripId).eq("user_id", user.uid).maybeSingle();
    if (mine) return NextResponse.json({ tripId, role: "commenter" });

    const email = user.email?.toLowerCase() ?? null;
    const name = (user.name as string | undefined) ?? null;
    // A pending email invite for this person becomes their membership instead of a duplicate row.
    const pending = email
      ? (await db.from("trip_members").select("id").eq("trip_id", tripId).is("user_id", null).eq("email", email).maybeSingle()).data
      : null;
    const { error } = pending
      ? await db.from("trip_members").update({ user_id: user.uid, display_name: name }).eq("id", pending.id)
      : await db.from("trip_members").insert({ trip_id: tripId, user_id: user.uid, email, display_name: name, invited_by: ownerId });
    if (error) throw new Error(error.message);
    return NextResponse.json({ tripId, role: "commenter" });
  } catch (e) {
    console.error("[trips/join]", e);
    return NextResponse.json({ error: "Couldn't join this trip" }, { status: 500 });
  }
}
