import type { RealtimeChannel } from "@supabase/supabase-js";
import type { ChatMessage, CommentStatus, Trip, TripComment, TripExpense, TripMember, TripTraveler, UserProfile } from "../types";
import { supabase } from "../supabase";
import type { TripStore, Unsubscribe } from "./types";

/**
 * Supabase Postgres store (see supabase/migrations). RLS scopes every query to the Firebase uid.
 *   profiles(id = uid, preferences jsonb)
 *   trips(owner_id = uid, itinerary jsonb) — plus trips shared with the user (trip_members), read-only
 *   messages(trip_id, created_at, seq) — owner only; append-only, except compaction (older messages → one summary)
 *   trip_members, trip_share_links, trip_comments — sharing and per-stop comments
 *   trip_expenses — actual spending, logged by the owner and members
 *   trip_travelers — who is going (members and virtual travelers; the owner is implicit)
 * Writes update a local cache first so the UI is instant; Realtime keeps other tabs/devices in sync.
 */
export class SupabaseStore implements TripStore {
  private trips: Trip[] | undefined;
  private tripSubs = new Set<(t: Trip[]) => void>();
  private tripChannel?: RealtimeChannel;
  private messages = new Map<string, ChatMessage[]>();
  private msgSubs = new Map<string, Set<(m: ChatMessage[]) => void>>();
  private msgChannels = new Map<string, RealtimeChannel>();
  private comments = new Map<string, TripComment[]>();
  private commentSubs = new Map<string, Set<(c: TripComment[]) => void>>();
  private commentChannels = new Map<string, RealtimeChannel>();
  private expenses = new Map<string, TripExpense[]>();
  private expenseSubs = new Map<string, Set<(e: TripExpense[]) => void>>();
  private expenseChannels = new Map<string, RealtimeChannel>();
  private travelers = new Map<string, TripTraveler[]>();
  private travelerSubs = new Map<string, Set<(t: TripTraveler[]) => void>>();
  private travelerChannels = new Map<string, RealtimeChannel>();

  constructor(private uid: string) {}

  // ───────────── trips ─────────────

  subscribeTrips(cb: (trips: Trip[]) => void): Unsubscribe {
    this.tripSubs.add(cb);
    if (this.trips) cb(this.trips);
    else this.loadTrips();
    // Unfiltered: RLS already limits events to the user's own trips and the ones shared with them.
    this.tripChannel ??= supabase()
      .channel(`trips:${this.uid}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "trips" }, () => this.loadTrips())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "trips" }, () => this.loadTrips())
      // Someone shared a trip with this user (UPDATE: an email invite was claimed).
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "trip_members", filter: `user_id=eq.${this.uid}` }, () => this.loadTrips())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "trip_members", filter: `user_id=eq.${this.uid}` }, () => this.loadTrips())
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

  refreshTrips() {
    return this.loadTrips();
  }

  // ───────────── comments ─────────────

  subscribeComments(tripId: string, cb: (comments: TripComment[]) => void): Unsubscribe {
    const subs = this.commentSubs.get(tripId) ?? new Set();
    subs.add(cb);
    this.commentSubs.set(tripId, subs);
    const cached = this.comments.get(tripId);
    if (cached) cb(cached);
    else this.loadComments(tripId);
    if (!this.commentChannels.has(tripId)) {
      const upsert = (p: { new: unknown }) => this.upsertComment(tripId, rowToComment(p.new as CommentRow));
      this.commentChannels.set(tripId, supabase()
        .channel(`comments:${tripId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "trip_comments", filter: `trip_id=eq.${tripId}` }, upsert)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "trip_comments", filter: `trip_id=eq.${tripId}` }, upsert)
        // DELETE events can't be filtered and only carry the primary key under RLS.
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "trip_comments" },
          (p) => this.dropComment(tripId, (p.old as { id?: string }).id))
        .subscribe());
    }
    return () => {
      subs.delete(cb);
      if (subs.size) return;
      const ch = this.commentChannels.get(tripId);
      if (ch) supabase().removeChannel(ch);
      this.commentChannels.delete(tripId);
      this.comments.delete(tripId);
    };
  }

  private async loadComments(tripId: string) {
    const { data, error } = await supabase().from("trip_comments").select("*").eq("trip_id", tripId).order("created_at");
    if (error) { console.error("[supabase] comments", error); return; }
    const loaded = (data as CommentRow[]).map(rowToComment);
    const ids = new Set(loaded.map((c) => c.id));
    this.setComments(tripId, [...loaded, ...(this.comments.get(tripId) ?? []).filter((c) => !ids.has(c.id))]);
  }

  private setComments(tripId: string, list: TripComment[]) {
    list = [...list].sort((a, b) => a.createdAt - b.createdAt);
    this.comments.set(tripId, list);
    this.commentSubs.get(tripId)?.forEach((cb) => cb(list));
  }

  private upsertComment(tripId: string, comment: TripComment) {
    const list = this.comments.get(tripId) ?? [];
    this.setComments(tripId, [...list.filter((c) => c.id !== comment.id), comment]);
  }

  private dropComment(tripId: string, id?: string) {
    const list = this.comments.get(tripId);
    if (id && list?.some((c) => c.id === id)) this.setComments(tripId, list.filter((c) => c.id !== id));
  }

  async addComment(comment: TripComment) {
    this.upsertComment(comment.tripId, comment);
    const { error } = await supabase().from("trip_comments").insert(commentToRow(comment));
    if (error) { this.dropComment(comment.tripId, comment.id); throw new Error(error.message); }
  }

  async deleteComment(comment: TripComment) {
    this.dropComment(comment.tripId, comment.id);
    const { error } = await supabase().from("trip_comments").delete().eq("id", comment.id);
    if (error) { await this.loadComments(comment.tripId); throw new Error(error.message); }
  }

  async setCommentStatus(tripId: string, ids: string[], status: CommentStatus) {
    if (!ids.length) return;
    const resolvedAt = status === "open" ? undefined : Date.now();
    for (const c of this.comments.get(tripId) ?? []) if (ids.includes(c.id)) this.upsertComment(tripId, { ...c, status, resolvedAt });
    const { error } = await supabase().from("trip_comments")
      .update({ status, resolved_at: resolvedAt ? iso(resolvedAt) : null }).eq("trip_id", tripId).in("id", ids);
    if (error) { await this.loadComments(tripId); throw new Error(error.message); }
  }

  // ───────────── expenses ─────────────

  subscribeExpenses(tripId: string, cb: (expenses: TripExpense[]) => void): Unsubscribe {
    const subs = this.expenseSubs.get(tripId) ?? new Set();
    subs.add(cb);
    this.expenseSubs.set(tripId, subs);
    const cached = this.expenses.get(tripId);
    if (cached) cb(cached);
    else this.loadExpenses(tripId);
    if (!this.expenseChannels.has(tripId)) {
      const upsert = (p: { new: unknown }) => this.upsertExpense(tripId, rowToExpense(p.new as ExpenseRow));
      this.expenseChannels.set(tripId, supabase()
        .channel(`expenses:${tripId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "trip_expenses", filter: `trip_id=eq.${tripId}` }, upsert)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "trip_expenses", filter: `trip_id=eq.${tripId}` }, upsert)
        // DELETE events can't be filtered and only carry the primary key under RLS.
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "trip_expenses" },
          (p) => this.dropExpense(tripId, (p.old as { id?: string }).id))
        .subscribe());
    }
    return () => {
      subs.delete(cb);
      if (subs.size) return;
      const ch = this.expenseChannels.get(tripId);
      if (ch) supabase().removeChannel(ch);
      this.expenseChannels.delete(tripId);
      this.expenses.delete(tripId);
    };
  }

  private async loadExpenses(tripId: string) {
    const { data, error } = await supabase().from("trip_expenses").select("*").eq("trip_id", tripId).order("spent_at");
    if (error) { console.error("[supabase] expenses", error); return; }
    const loaded = (data as ExpenseRow[]).map(rowToExpense);
    const ids = new Set(loaded.map((e) => e.id));
    this.setExpenses(tripId, [...loaded, ...(this.expenses.get(tripId) ?? []).filter((e) => !ids.has(e.id))]);
  }

  private setExpenses(tripId: string, list: TripExpense[]) {
    list = [...list].sort((a, b) => b.spentAt - a.spentAt || b.createdAt - a.createdAt); // newest first
    this.expenses.set(tripId, list);
    this.expenseSubs.get(tripId)?.forEach((cb) => cb(list));
  }

  private upsertExpense(tripId: string, expense: TripExpense) {
    const list = this.expenses.get(tripId) ?? [];
    this.setExpenses(tripId, [...list.filter((e) => e.id !== expense.id), expense]);
  }

  private dropExpense(tripId: string, id?: string) {
    const list = this.expenses.get(tripId);
    if (id && list?.some((e) => e.id === id)) this.setExpenses(tripId, list.filter((e) => e.id !== id));
  }

  async saveExpense(expense: TripExpense, isNew: boolean) {
    this.upsertExpense(expense.tripId, expense);
    const row = expenseToRow(expense);
    const { error } = isNew
      ? await supabase().from("trip_expenses").insert(row)
      // Only the columns `authenticated` may update (trip, author and created_at stay fixed).
      : await supabase().from("trip_expenses").update({
        item_id: row.item_id, day: row.day, title: row.title, amount: row.amount, currency: row.currency,
        category: row.category, note: row.note, spent_at: row.spent_at,
        paid_by: row.paid_by, paid_by_name: row.paid_by_name, split: row.split,
      }).eq("id", expense.id);
    if (error) { await this.loadExpenses(expense.tripId); throw new Error(error.message); }
  }

  async deleteExpense(expense: TripExpense) {
    this.dropExpense(expense.tripId, expense.id);
    const { error } = await supabase().from("trip_expenses").delete().eq("id", expense.id);
    if (error) { await this.loadExpenses(expense.tripId); throw new Error(error.message); }
  }

  // ───────────── travelers ─────────────

  subscribeTravelers(tripId: string, cb: (travelers: TripTraveler[]) => void): Unsubscribe {
    const subs = this.travelerSubs.get(tripId) ?? new Set();
    subs.add(cb);
    this.travelerSubs.set(tripId, subs);
    const cached = this.travelers.get(tripId);
    if (cached) cb(cached);
    else this.loadTravelers(tripId);
    if (!this.travelerChannels.has(tripId)) {
      const upsert = (p: { new: unknown }) => this.upsertTraveler(tripId, rowToTraveler(p.new as TravelerRow));
      this.travelerChannels.set(tripId, supabase()
        .channel(`travelers:${tripId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "trip_travelers", filter: `trip_id=eq.${tripId}` }, upsert)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "trip_travelers", filter: `trip_id=eq.${tripId}` }, upsert)
        // DELETE events can't be filtered and only carry the primary key under RLS.
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "trip_travelers" },
          (p) => this.dropTraveler(tripId, (p.old as { id?: string }).id))
        .subscribe());
    }
    return () => {
      subs.delete(cb);
      if (subs.size) return;
      const ch = this.travelerChannels.get(tripId);
      if (ch) supabase().removeChannel(ch);
      this.travelerChannels.delete(tripId);
      this.travelers.delete(tripId);
    };
  }

  private async loadTravelers(tripId: string) {
    const { data, error } = await supabase().from("trip_travelers").select("*").eq("trip_id", tripId).order("created_at");
    if (error) { console.error("[supabase] travelers", error); return; }
    this.setTravelers(tripId, (data as TravelerRow[]).map(rowToTraveler));
  }

  private setTravelers(tripId: string, list: TripTraveler[]) {
    list = [...list].sort((a, b) => a.createdAt - b.createdAt);
    this.travelers.set(tripId, list);
    this.travelerSubs.get(tripId)?.forEach((cb) => cb(list));
  }

  private upsertTraveler(tripId: string, traveler: TripTraveler) {
    const list = this.travelers.get(tripId) ?? [];
    this.setTravelers(tripId, [...list.filter((t) => t.id !== traveler.id), traveler]);
  }

  private dropTraveler(tripId: string, id?: string) {
    const list = this.travelers.get(tripId);
    if (id && list?.some((t) => t.id === id)) this.setTravelers(tripId, list.filter((t) => t.id !== id));
  }

  async addTraveler(t: TripTraveler) {
    this.upsertTraveler(t.tripId, t);
    const { error } = await supabase().from("trip_travelers")
      .insert({ id: t.id, trip_id: t.tripId, user_id: t.userId ?? null, name: t.name, created_by: this.uid, created_at: iso(t.createdAt) });
    if (error) { this.dropTraveler(t.tripId, t.id); throw new Error(error.message); }
  }

  async renameTraveler(t: TripTraveler, name: string) {
    this.upsertTraveler(t.tripId, { ...t, name });
    const { error } = await supabase().from("trip_travelers").update({ name }).eq("id", t.id);
    if (error) { await this.loadTravelers(t.tripId); throw new Error(error.message); }
  }

  async removeTraveler(t: TripTraveler) {
    this.dropTraveler(t.tripId, t.id);
    const { error } = await supabase().from("trip_travelers").delete().eq("id", t.id);
    if (error) { await this.loadTravelers(t.tripId); throw new Error(error.message); }
  }

  // ───────────── members + share link ─────────────

  async listMembers(tripId: string) {
    const { data, error } = await supabase().from("trip_members").select("*").eq("trip_id", tripId).order("created_at");
    if (error) throw new Error(error.message);
    return (data as MemberRow[]).map(rowToMember);
  }

  async removeMember(member: TripMember) {
    const { error } = await supabase().from("trip_members").delete().eq("id", member.id);
    if (error) throw new Error(error.message);
    if (member.userId === this.uid) this.dropTrip(member.tripId); // left the trip
  }

  async getShareToken(tripId: string) {
    const { data, error } = await supabase().from("trip_share_links").select("token").eq("trip_id", tripId).maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.token as string | undefined) ?? undefined;
  }

  async resetShareToken(tripId: string, enabled: boolean) {
    if (!enabled) {
      const { error } = await supabase().from("trip_share_links").delete().eq("trip_id", tripId);
      if (error) throw new Error(error.message);
      return undefined;
    }
    const token = randomToken();
    const { error } = await supabase().from("trip_share_links").upsert({ trip_id: tripId, token, created_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return token;
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
    this.commentChannels.forEach((ch) => sb.removeChannel(ch));
    this.commentChannels.clear();
    this.expenseChannels.forEach((ch) => sb.removeChannel(ch));
    this.expenseChannels.clear();
    this.travelerChannels.forEach((ch) => sb.removeChannel(ch));
    this.travelerChannels.clear();
    this.travelerSubs.clear();
    this.tripSubs.clear();
    this.expenseSubs.clear();
    this.msgSubs.clear();
    this.commentSubs.clear();
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

interface CommentRow {
  id: string; trip_id: string; item_id: string; day: number | null; item_title: string; author_id: string; author_name: string;
  text: string; status: TripComment["status"]; resolved_at: string | null; created_at: string;
}

interface ExpenseRow {
  id: string; trip_id: string; item_id: string | null; day: number | null; title: string;
  /** numeric comes back as a string. */
  amount: number | string;
  currency: string; category: TripExpense["category"]; note: string; author_id: string; author_name: string;
  paid_by: string | null; paid_by_name: string; split: TripExpense["split"] | null;
  spent_at: string; created_at: string;
}

interface TravelerRow { id: string; trip_id: string; user_id: string | null; name: string; created_at: string }

interface MemberRow {
  id: string; trip_id: string; user_id: string | null; email: string | null; display_name: string | null;
  role: TripMember["role"]; created_at: string;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** 144-bit URL-safe share-link token. */
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_");
}

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

function rowToComment(r: CommentRow): TripComment {
  return {
    id: r.id, tripId: r.trip_id, itemId: r.item_id, day: r.day ?? undefined, itemTitle: r.item_title,
    authorId: r.author_id, authorName: r.author_name, text: r.text, status: r.status,
    createdAt: Date.parse(r.created_at), resolvedAt: r.resolved_at ? Date.parse(r.resolved_at) : undefined,
  };
}

function commentToRow(c: TripComment): Omit<CommentRow, "resolved_at"> {
  return {
    id: c.id, trip_id: c.tripId, item_id: c.itemId, day: c.day ?? null, item_title: c.itemTitle,
    author_id: c.authorId, author_name: c.authorName, text: c.text, status: "open", created_at: iso(c.createdAt),
  };
}

function rowToMember(r: MemberRow): TripMember {
  return {
    id: r.id, tripId: r.trip_id, userId: r.user_id ?? undefined, email: r.email ?? undefined,
    displayName: r.display_name ?? undefined, role: r.role, createdAt: Date.parse(r.created_at),
  };
}

function rowToExpense(r: ExpenseRow): TripExpense {
  return {
    id: r.id, tripId: r.trip_id, itemId: r.item_id ?? undefined, day: r.day ?? undefined, title: r.title,
    amount: Number(r.amount), currency: r.currency, category: r.category, note: r.note ?? "",
    paidBy: r.paid_by ? { key: r.paid_by, name: r.paid_by_name } : undefined,
    split: r.split?.shares?.length ? { ...r.split, shares: r.split.shares.map((x) => ({ ...x, amount: Number(x.amount) })) } : undefined,
    authorId: r.author_id, authorName: r.author_name, spentAt: Date.parse(r.spent_at), createdAt: Date.parse(r.created_at),
  };
}

function expenseToRow(e: TripExpense): ExpenseRow {
  return {
    id: e.id, trip_id: e.tripId, item_id: e.itemId ?? null, day: e.day ?? null, title: e.title, amount: e.amount,
    currency: e.currency, category: e.category, note: e.note, author_id: e.authorId, author_name: e.authorName,
    paid_by: e.paidBy?.key ?? null, paid_by_name: e.paidBy?.name ?? "", split: e.split ?? null,
    spent_at: iso(e.spentAt), created_at: iso(e.createdAt),
  };
}

function rowToTraveler(r: TravelerRow): TripTraveler {
  return { id: r.id, tripId: r.trip_id, userId: r.user_id ?? undefined, name: r.name ?? "", createdAt: Date.parse(r.created_at) };
}
