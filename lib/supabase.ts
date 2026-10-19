import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { firebaseAuth } from "./firebase";

let client: SupabaseClient | undefined;

/**
 * Browser client authenticated with the Firebase ID token (Supabase third-party auth).
 * RLS sees the Firebase uid as `auth.jwt()->>'sub'`.
 */
export function supabase() {
  client ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    accessToken: async () => (await firebaseAuth().currentUser?.getIdToken(false)) ?? null,
  });
  return client;
}
