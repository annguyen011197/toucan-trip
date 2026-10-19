import type { TripStore } from "./types";
import { LocalStore } from "./local-store";

export type { TripStore } from "./types";

/** Firebase when NEXT_PUBLIC_FIREBASE_* is configured, otherwise browser storage. */
export async function createStore(): Promise<TripStore> {
  if (process.env.NEXT_PUBLIC_FIREBASE_API_KEY && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) {
    const { FirebaseStore } = await import("./firebase-store"); // keeps the Firebase SDK out of the default bundle
    return new FirebaseStore();
  }
  return new LocalStore();
}
