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
    return NextResponse.json({ refreshToken });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: 401 });
    console.error("[auth/sync]", e);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
