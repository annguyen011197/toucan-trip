import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function adminAuth() {
  const app = getApps()[0] ?? initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel / .env store the PEM on one line with literal \n.
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
  return getAuth(app);
}

export class AuthError extends Error {}

/** Verifies the `Authorization: Bearer <Firebase ID token>` header. */
export async function verifyRequest(request: Request): Promise<DecodedIdToken> {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new AuthError("Missing token");
  try {
    return await adminAuth().verifyIdToken(token);
  } catch {
    throw new AuthError("Invalid token");
  }
}

/** Supabase third-party auth maps the JWT `role` claim to a Postgres role; Firebase tokens don't carry one by default. */
export async function ensureSupabaseRole(user: DecodedIdToken): Promise<boolean> {
  if (user.role === "authenticated") return false;
  const auth = adminAuth();
  const { customClaims } = await auth.getUser(user.uid);
  await auth.setCustomUserClaims(user.uid, { ...customClaims, role: "authenticated" });
  return true;
}

let admin: SupabaseClient | undefined;

/** Service-role client. Bypasses RLS — server only, never for user-supplied queries. */
export function supabaseAdmin() {
  admin ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

/** Escapes LIKE wildcards so an email can be matched case-insensitively with `.ilike()`. */
export const likeExact = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
