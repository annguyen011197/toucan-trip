import { NextResponse } from "next/server";
import { AuthError, ensureSupabaseRole, supabaseAdmin, verifyRequest } from "@/lib/server/auth";

export const runtime = "nodejs";

/**
 * Called by the client after every Firebase sign-in:
 *  1. adds the `role: "authenticated"` custom claim Supabase needs (client then force-refreshes its ID token),
 *  2. upserts the Firebase user into `public.profiles` (preferences are left untouched).
 */
export async function POST(request: Request) {
  try {
    const user = await verifyRequest(request);
    const refreshToken = await ensureSupabaseRole(user);
    const { error } = await supabaseAdmin().from("profiles").upsert({
      id: user.uid,
      email: user.email ?? null,
      display_name: (user.name as string | undefined) ?? null,
      photo_url: user.picture ?? null,
      last_sign_in_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    // Email invites sent before this person had an account. Verified emails only, so nobody can claim
    // someone else's invite by signing up with their address.
    if (user.email && user.email_verified) {
      await claimInvites(user.uid, user.email.toLowerCase(), (user.name as string | undefined) ?? null);
    }
    return NextResponse.json({ refreshToken });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: 401 });
    console.error("[auth/sync]", e);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}

async function claimInvites(uid: string, email: string, name: string | null) {
  const db = supabaseAdmin();
  const { data: pending, error } = await db.from("trip_members").select("id").is("user_id", null).eq("email", email);
  if (error) { console.error("[auth/sync] invites", error); return; }
  for (const { id } of pending ?? []) {
    const { error: claimError } = await db.from("trip_members").update({ user_id: uid, display_name: name }).eq("id", id);
    // 23505: already a member of that trip (e.g. joined by link first), so the invite is redundant.
    if (claimError?.code === "23505") await db.from("trip_members").delete().eq("id", id);
    else if (claimError) console.error("[auth/sync] claim invite", claimError);
  }
}
