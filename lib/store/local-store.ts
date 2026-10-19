import type { ChatMessage, Trip, UserProfile } from "../types";
import { seedTrips } from "../mock-data";
import type { TripStore, Unsubscribe } from "./types";

const KEY = "toucan-trip:v1";
const UID = "local-user";

interface Data {
  trips: Trip[];
  messages: Record<string, ChatMessage[]>;
  profile?: UserProfile;
}

/** Browser storage (zero-config). Realtime across components via listeners and across tabs via `storage` events. */
export class LocalStore implements TripStore {
  kind = "local" as const;
  private data: Data = { trips: [], messages: {} };
  private tripSubs = new Set<(t: Trip[]) => void>();
  private msgSubs = new Map<string, Set<(m: ChatMessage[]) => void>>();

  async init() {
    this.data = this.read() ?? this.seed();
    window.addEventListener("storage", (e) => {
      if (e.key !== KEY) return;
      this.data = this.read() ?? this.data;
      this.emitAll();
    });
    return UID;
  }

  private read(): Data | undefined {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as Data) : undefined;
    } catch {
      return undefined;
    }
  }

  private write() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* private mode / quota: keep in memory */ }
  }

  private seed(): Data {
    const seeded = seedTrips(UID);
    const d: Data = { trips: seeded.map((s) => s.trip), messages: Object.fromEntries(seeded.map((s) => [s.trip.id, s.messages])) };
    this.data = d;
    this.write();
    return d;
  }

  private sortedTrips() {
    return [...this.data.trips].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private emitAll() {
    this.tripSubs.forEach((cb) => cb(this.sortedTrips()));
    this.msgSubs.forEach((subs, tripId) => subs.forEach((cb) => cb(this.data.messages[tripId] ?? [])));
  }

  subscribeTrips(_uid: string, cb: (trips: Trip[]) => void): Unsubscribe {
    this.tripSubs.add(cb);
    cb(this.sortedTrips());
    return () => { this.tripSubs.delete(cb); };
  }

  subscribeMessages(tripId: string, cb: (messages: ChatMessage[]) => void): Unsubscribe {
    const set = this.msgSubs.get(tripId) ?? new Set();
    set.add(cb);
    this.msgSubs.set(tripId, set);
    cb(this.data.messages[tripId] ?? []);
    return () => { set.delete(cb); };
  }

  async saveTrip(trip: Trip) {
    const i = this.data.trips.findIndex((t) => t.id === trip.id);
    if (i >= 0) this.data.trips[i] = trip; else this.data.trips.push(trip);
    this.write();
    this.tripSubs.forEach((cb) => cb(this.sortedTrips()));
  }

  async deleteTrip(id: string) {
    this.data.trips = this.data.trips.filter((t) => t.id !== id);
    delete this.data.messages[id];
    this.write();
    this.emitAll();
  }

  async addMessage(tripId: string, message: ChatMessage) {
    const list = [...(this.data.messages[tripId] ?? [])];
    const last = list[list.length - 1];
    const msg = last && message.createdAt <= last.createdAt ? { ...message, createdAt: last.createdAt + 1 } : message;
    list.push(msg);
    this.data.messages[tripId] = list;
    this.write();
    this.msgSubs.get(tripId)?.forEach((cb) => cb(list));
  }

  async getProfile() { return this.data.profile; }

  async saveProfile(_uid: string, profile: UserProfile) {
    this.data.profile = profile;
    this.write();
  }

  /** Dev helper: wipe and reseed. */
  reset() {
    localStorage.removeItem(KEY);
    this.seed();
    this.emitAll();
  }
}
