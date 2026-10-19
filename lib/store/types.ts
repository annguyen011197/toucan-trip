import type { ChatMessage, Trip, UserProfile } from "../types";

export type Unsubscribe = () => void;

/**
 * Persistence + realtime for the signed-in user. Every view subscribes, so an edit from Chat or the
 * Itinerary tab shows up everywhere (local cache + Supabase Realtime for other tabs/devices).
 */
export interface TripStore {
  subscribeTrips(cb: (trips: Trip[]) => void): Unsubscribe;
  subscribeMessages(tripId: string, cb: (messages: ChatMessage[]) => void): Unsubscribe;
  saveTrip(trip: Trip): Promise<void>;
  deleteTrip(id: string): Promise<void>;
  addMessage(tripId: string, message: ChatMessage): Promise<void>;
  /** Atomically deletes `messageIds` and inserts `summary` in their place. */
  compactMessages(tripId: string, messageIds: string[], summary: ChatMessage): Promise<void>;
  getProfile(): Promise<Partial<UserProfile> | undefined>;
  saveProfile(profile: UserProfile): Promise<void>;
  dispose(): void;
}
