import type { ChatMessage, Trip, UserProfile } from "../types";

export type Unsubscribe = () => void;

/**
 * Persistence + realtime. Every view subscribes, so an edit from Chat or the Itinerary tab
 * shows up everywhere (Firestore listeners, or in-browser listeners + cross-tab sync).
 */
export interface TripStore {
  kind: "local" | "firebase";
  /** Signs in (anonymous on Firebase) and returns the user id. */
  init(): Promise<string>;
  subscribeTrips(uid: string, cb: (trips: Trip[]) => void): Unsubscribe;
  subscribeMessages(tripId: string, cb: (messages: ChatMessage[]) => void): Unsubscribe;
  saveTrip(trip: Trip): Promise<void>;
  deleteTrip(id: string): Promise<void>;
  addMessage(tripId: string, message: ChatMessage): Promise<void>;
  getProfile(uid: string): Promise<UserProfile | undefined>;
  saveProfile(uid: string, profile: UserProfile): Promise<void>;
}
