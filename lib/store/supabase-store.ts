import type { RealtimeChannel } from "@supabase/supabase-js";
import type { ChatMessage, Trip, UserProfile } from "../types";
import { supabase } from "../supabase";
import type { TripStore, Unsubscribe } from "./types";

/**
 * Supabase Postgres store (see supabase/migrations). RLS scopes every query to the Firebase uid.
 *   profiles(id = uid, preferences jsonb)
 *   trips(owner_id = uid, itinerary jsonb)
 *   messages(trip_id, created_at, seq) — append-only, except compaction (older messages → one summary)
 * Writes update a local cache first so the UI is instant; Realtime keeps other tabs/devices in sync.
 */
export class SupabaseStore implements TripStore {
  private trips: Trip[] | undefined;
  private tripSubs = new Set<(t: Trip[]) => void>();
  private tripChannel?: RealtimeChannel;
  private messages = new Map<string, ChatMessage[]>();
  private msgSubs = new Map<string, Set<(m: ChatMessage[]) => void>>();
  private msgChannels = new Map<string, RealtimeChannel>();

  constructor(private uid: string) {}

  // ───────────── trips ─────────────

  subscribeTrips(cb: (trips: Trip[]) => void): Unsubscribe {
    this.tripSubs.add(cb);
    if (this.trips) cb(this.trips);
    else this.loadTrips();
    this.tripChannel ??= supabase()
      .channel(`trips:${this.uid}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "trips", filter: `owner_id=eq.${this.uid}` }, () => this.loadTrips())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "trips", filter: `owner_id=eq.${this.uid}` }, () => this.loadTrips())
      // DELETE events can't be filtered and only carry the primary key under RLS.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "trips" }, (p) => this.dropTrip((p.old as { id?: string }).id))
      .subscribe();
    return () => { this.tripSubs.delete(cb); };
  }

  private async loadTrips() {
    const { data, error } = await supabase().from("trips").select("*").order("updated_at", { ascending: false });
    if (error) { console.error("[supabase] trips", error); return; }
    this.setTrips((data as TripRow[]).map(rowToTrip));
  }

  private setTrips(trips: Trip[]) {
    this.trips = [...trips].sort((a, b) => b.updatedAt - a.updatedAt);
    this.tripSubs.forEach((cb) => cb(this.trips!));
  }

  private dropTrip(id?: string) {
    if (id && this.trips?.some((t) => t.id === id)) this.setTrips(this.trips.filter((t) => t.id !== id));
  }

  async saveTrip(trip: Trip) {
    const rest = (this.trips ?? []).filter((t) => t.id !== trip.id);
    this.setTrips([trip, ...rest]);
    const { error } = await supabase().from("trips").upsert(tripToRow(trip, this.uid));
    if (error) { await this.loadTrips(); throw new Error(error.message); }
  }

  async deleteTrip(id: string) {
    this.dropTrip(id);
    const { error } = await supabase().from("trips").delete().eq("id", id);
    if (error) { await this.loadTrips(); throw new Error(error.message); }
  }

  // ───────────── messages ─────────────

  subscribeMessages(tripId: string, cb: (messages: ChatMessage[]) => void): Unsubscribe {
    const subs = this.msgSubs.get(tripId) ?? new Set();
    subs.add(cb);
    this.msgSubs.set(tripId, subs);
    const cached = this.messages.get(tripId);
    if (cached) cb(cached);
    else this.loadMessages(tripId);
    if (!this.msgChannels.has(tripId)) {
      this.msgChannels.set(tripId, supabase()
        .channel(`messages:${tripId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `trip_id=eq.${tripId}` },
          (p) => this.appendMessage(tripId, rowToMessage(p.new as MessageRow)))
        // DELETE events can't be filtered and only carry the primary key under RLS.
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" },
          (p) => this.dropMessages(tripId, [(p.old as { id?: string }).id ?? ""]))
        .subscribe());
    }
    return () => {
      subs.delete(cb);
      if (subs.size) return;
      const ch = this.msgChannels.get(tripId);
      if (ch) supabase().removeChannel(ch);
      this.msgChannels.delete(tripId);
      this.messages.delete(tripId);
    };
  }

  private async loadMessages(tripId: string) {
    const { data, error } = await supabase().from("messages").select("*").eq("trip_id", tripId).order("created_at").order("seq");
    if (error) { console.error("[supabase] messages", error); return; }
    // Keep anything added locally while the fetch was in flight.
    const loaded = (data as MessageRow[]).map(rowToMessage);
    const ids = new Set(loaded.map((m) => m.id));
    this.setMessages(tripId, [...loaded, ...(this.messages.get(tripId) ?? []).filter((m) => !ids.has(m.id))]);
  }

  private setMessages(tripId: string, list: ChatMessage[]) {
    list = [...list].sort((a, b) => a.createdAt - b.createdAt); // stable: ties keep arrival order
    this.messages.set(tripId, list);
    this.msgSubs.get(tripId)?.forEach((cb) => cb(list));
  }

  private appendMessage(tripId: string, message: ChatMessage) {
    const list = this.messages.get(tripId) ?? [];
    if (list.some((m) => m.id === message.id)) return;
    this.setMessages(tripId, [...list, message]);
  }

  private dropMessages(tripId: string, ids: string[]) {
    const list = this.messages.get(tripId);
    if (list?.some((m) => ids.includes(m.id))) this.setMessages(tripId, list.filter((m) => !ids.includes(m.id)));
  }

  async addMessage(tripId: string, message: ChatMessage) {
    // Strictly increasing timestamps keep order stable (messages are sorted by time).
    const last = this.messages.get(tripId)?.at(-1);
    if (last && message.createdAt <= last.createdAt) message = { ...message, createdAt: last.createdAt + 1 };
    this.appendMessage(tripId, message);
    const { error } = await supabase().from("messages").insert(messageToRow(message, tripId, this.uid));
    if (error) throw new Error(error.message);
  }

  async compactMessages(tripId: string, messageIds: string[], summary: ChatMessage) {
    const { error } = await supabase().rpc("compact_messages", {
      p_trip_id: tripId, p_message_ids: messageIds, p_summary_id: summary.id, p_summary: summary.text,
    });
    if (error) throw new Error(error.message);
    const removed = (this.messages.get(tripId) ?? []).filter((m) => messageIds.includes(m.id));
    const createdAt = Math.min(...removed.map((m) => m.createdAt), summary.createdAt);
    this.dropMessages(tripId, messageIds);
    this.appendMessage(tripId, { ...summary, createdAt });
  }

  // ───────────── profile ─────────────

  async getProfile() {
    const { data, error } = await supabase().from("profiles").select("display_name, preferences").eq("id", this.uid).maybeSingle();
    if (error) { console.error("[supabase] profile", error); return undefined; }
    if (!data) return undefined;
    const prefs = (data.preferences ?? {}) as Partial<UserProfile>;
    return { ...prefs, name: prefs.name || data.display_name || undefined };
  }

  async saveProfile(profile: UserProfile) {
    const { error } = await supabase().from("profiles")
      .update({ preferences: profile, display_name: profile.name, updated_at: new Date().toISOString() })
      .eq("id", this.uid);
    if (error) throw new Error(error.message);
  }

  dispose() {
    const sb = supabase();
    if (this.tripChannel) sb.removeChannel(this.tripChannel);
    this.msgChannels.forEach((ch) => sb.removeChannel(ch));
    this.msgChannels.clear();
    this.tripSubs.clear();
    this.msgSubs.clear();
  }
}

// ───────────── row mapping ─────────────

interface TripRow {
  id: string; owner_id: string; title: string; destination: string | null; origin: string | null;
  start_date: string | null; end_date: string | null; travelers: number | null; budget: string | null; interests: string[];
  status: Trip["status"]; cover_image_url: string | null; hotel: Trip["hotel"] | null; itinerary: Trip["itinerary"];
  currency: string; language: NonNullable<Trip["language"]>; created_at: string; updated_at: string;
}

interface MessageRow {
  id: string; trip_id: string; owner_id: string; role: ChatMessage["role"]; type: ChatMessage["type"]; text: string;
  quick_replies: string[]; cards: ChatMessage["cards"]; created_at: string;
}

const iso = (ms: number) => new Date(ms).toISOString();

function rowToTrip(r: TripRow): Trip {
  return {
    id: r.id, ownerId: r.owner_id, title: r.title,
    destination: r.destination ?? undefined, origin: r.origin ?? undefined,
    startDate: r.start_date ?? undefined, endDate: r.end_date ?? undefined,
    travelers: r.travelers ?? undefined, budget: r.budget ?? undefined, interests: r.interests,
    status: r.status, coverImageUrl: r.cover_image_url ?? undefined, hotel: r.hotel ?? undefined,
    itinerary: r.itinerary ?? [], currency: r.currency, language: r.language ?? "en",
    createdAt: Date.parse(r.created_at), updatedAt: Date.parse(r.updated_at),
  };
}

function tripToRow(t: Trip, uid: string): TripRow {
  return {
    id: t.id, owner_id: uid, title: t.title,
    destination: t.destination ?? null, origin: t.origin ?? null,
    start_date: t.startDate ?? null, end_date: t.endDate ?? null,
    travelers: t.travelers ?? null, budget: t.budget ?? null, interests: t.interests ?? [],
    status: t.status, cover_image_url: t.coverImageUrl ?? null, hotel: t.hotel ?? null,
    itinerary: t.itinerary, currency: t.currency, language: t.language ?? "en",
    created_at: iso(t.createdAt), updated_at: iso(t.updatedAt),
  };
}

function rowToMessage(r: MessageRow): ChatMessage {
  return { id: r.id, role: r.role, type: r.type, text: r.text, quickReplies: r.quick_replies ?? [], cards: r.cards ?? [], createdAt: Date.parse(r.created_at) };
}

function messageToRow(m: ChatMessage, tripId: string, uid: string): MessageRow {
  return {
    id: m.id, trip_id: tripId, owner_id: uid, role: m.role, type: m.type, text: m.text,
    quick_replies: m.quickReplies, cards: m.cards, created_at: iso(m.createdAt),
  };
}
