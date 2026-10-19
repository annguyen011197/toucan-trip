import type { ChatMessage, CommentStatus, Trip, TripComment, TripMember, UserProfile } from "../types";

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
  /** Re-reads the trip list, e.g. after joining a shared trip. */
  refreshTrips(): Promise<void>;
  addMessage(tripId: string, message: ChatMessage): Promise<void>;
  /** Atomically deletes `messageIds` and inserts `summary` in their place. */
  compactMessages(tripId: string, messageIds: string[], summary: ChatMessage): Promise<void>;
  /** Comments on a trip's stops (owner and members). */
  subscribeComments(tripId: string, cb: (comments: TripComment[]) => void): Unsubscribe;
  addComment(comment: TripComment): Promise<void>;
  deleteComment(comment: TripComment): Promise<void>;
  /** Owner only. */
  setCommentStatus(tripId: string, ids: string[], status: CommentStatus): Promise<void>;
  listMembers(tripId: string): Promise<TripMember[]>;
  /** Owner removes a member, or a member leaves (their own row). */
  removeMember(member: TripMember): Promise<void>;
  /** Owner only: the trip's share-link token, if link sharing is on. */
  getShareToken(tripId: string): Promise<string | undefined>;
  /** Owner only: turns link sharing on with a fresh token (old links stop working) or off. */
  resetShareToken(tripId: string, enabled: boolean): Promise<string | undefined>;
  getProfile(): Promise<Partial<UserProfile> | undefined>;
  saveProfile(profile: UserProfile): Promise<void>;
  dispose(): void;
}
