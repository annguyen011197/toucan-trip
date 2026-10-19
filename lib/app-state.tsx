"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ChatMessage, ChatResponse, Destination, ItineraryOp, Trip, TripStatus, UserProfile } from "./types";
import { DEFAULT_PROFILE } from "./types";
import { createStore, type TripStore } from "./store";
import { findCity } from "./mock-data";
import { greeting } from "./greeting";
import { applyItinerary } from "./tools";
import { uid } from "./util";

export type Tab = "home" | "chat" | "itinerary" | "map" | "profile";

const msg = (m: Omit<ChatMessage, "id" | "createdAt" | "quickReplies" | "cards"> & Partial<ChatMessage>): ChatMessage =>
  ({ id: uid(), createdAt: Date.now(), quickReplies: [], cards: [], ...m });

export function botMessage(text: string, quickReplies: string[] = [], cards: ChatMessage["cards"] = []): ChatMessage {
  const kind = cards[0]?.kind;
  const type: ChatMessage["type"] =
    kind === "flight" ? "flightCard" : kind === "hotel" ? "hotelCard" : kind === "place" ? "placeCard" : quickReplies.length ? "quickReplies" : "text";
  return msg({ role: "bot", type, text, quickReplies, cards });
}

const itineraryUpdateMessage = (changes: string[]) =>
  msg({ role: "bot", type: "itineraryUpdate", text: "", cards: [{ id: uid(), kind: "itineraryUpdate", title: "Itinerary updated", changes }] });

interface AppContextValue {
  ready: boolean;
  storeKind: TripStore["kind"];
  engine: "gemini" | "offline" | "unknown";
  uid: string;
  trips: Trip[];
  profile: UserProfile;
  tab: Tab;
  setTab: (t: Tab) => void;
  selectedTrip?: Trip;
  selectTrip: (id: string, tab?: Tab) => void;
  startNewTrip: (destination?: Destination) => Promise<void>;
  deleteTrip: (id: string) => Promise<void>;
  setStatus: (trip: Trip, status: TripStatus) => Promise<void>;
  applyItinerary: (trip: Trip, ops: ItineraryOp[]) => Promise<void>;
  subscribeMessages: (tripId: string, cb: (m: ChatMessage[]) => void) => () => void;
  sendChat: (trip: Trip, text: string, history: ChatMessage[]) => Promise<void>;
  saveProfile: (p: UserProfile) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

const SELECTED_KEY = "toucan-trip:selected";

export function AppProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<TripStore | null>(null);
  const [ready, setReady] = useState(false);
  const [storeKind, setStoreKind] = useState<TripStore["kind"]>("local");
  const [engine, setEngine] = useState<AppContextValue["engine"]>("unknown");
  const [userId, setUserId] = useState("local-user");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [tab, setTabState] = useState<Tab>("home");
  const [selectedId, setSelectedId] = useState<string | undefined>();

  useEffect(() => {
    let off: (() => void) | undefined;
    (async () => {
      const store = await createStore();
      storeRef.current = store;
      setStoreKind(store.kind);
      const id = await store.init();
      setUserId(id);
      const saved = await store.getProfile(id);
      if (saved) setProfile({ ...DEFAULT_PROFILE, ...saved });
      try { setSelectedId(localStorage.getItem(SELECTED_KEY) ?? undefined); } catch { /* ignore */ }
      off = store.subscribeTrips(id, setTrips);
      setReady(true);
    })().catch((e) => { console.error(e); setReady(true); });
    fetch("/api/chat").then((r) => r.json()).then((j) => setEngine(j.engine)).catch(() => setEngine("offline"));
    return () => off?.();
  }, []);

  // Keep a valid selection.
  useEffect(() => {
    if (!ready) return;
    if (!selectedId || !trips.some((t) => t.id === selectedId)) setSelectedId(trips[0]?.id);
  }, [ready, trips, selectedId]);

  useEffect(() => {
    try { if (selectedId) localStorage.setItem(SELECTED_KEY, selectedId); } catch { /* ignore */ }
  }, [selectedId]);

  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);

  const store = () => {
    if (!storeRef.current) throw new Error("Store not ready");
    return storeRef.current;
  };

  const selectTrip = useCallback((id: string, t: Tab = "itinerary") => { setSelectedId(id); setTab(t); }, [setTab]);

  const startNewTrip = useCallback(async (destination?: Destination) => {
    const now = Date.now();
    const trip: Trip = { id: uid(), ownerId: userId, title: "New Trip", status: "dreaming", itinerary: [], currency: "USD", createdAt: now, updatedAt: now };
    if (destination) {
      const city = findCity(destination.destination);
      trip.destination = city?.name ?? destination.destination;
      trip.title = `${destination.destination.split(",")[0]} Adventure`;
      trip.coverImageUrl = destination.imageUrl ?? city?.cover;
    }
    await store().saveTrip(trip);
    const hello = greeting(trip, profile);
    await store().addMessage(trip.id, botMessage(hello.text, hello.quickReplies));
    setSelectedId(trip.id);
    setTab("chat");
  }, [userId, profile, setTab]);

  const deleteTrip = useCallback(async (id: string) => { await store().deleteTrip(id); }, []);

  const setStatus = useCallback(async (trip: Trip, status: TripStatus) => {
    await store().saveTrip({ ...trip, status, updatedAt: Date.now() });
  }, []);

  /** Itinerary-tab edits: same engine as chat, and the bot posts the itineraryUpdate card. */
  const applyItineraryOps = useCallback(async (trip: Trip, ops: ItineraryOp[]) => {
    const { trip: next, result } = applyItinerary(trip, ops);
    await store().saveTrip(next);
    if (result.changes.length) await store().addMessage(trip.id, itineraryUpdateMessage(result.changes));
  }, []);

  const sendChat = useCallback(async (trip: Trip, text: string, history: ChatMessage[]) => {
    const s = store();
    await s.addMessage(trip.id, msg({ role: "user", type: "text", text }));
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, trip, history: history.slice(-30), profile }),
      });
      const data = (await res.json()) as ChatResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await s.saveTrip(data.trip);
      // Update card first, so the reply (with its chips) is always the latest message.
      if (data.itineraryChanges.length) await s.addMessage(trip.id, itineraryUpdateMessage(data.itineraryChanges));
      await s.addMessage(trip.id, botMessage(data.text, data.quickReplies, data.cards));
      setEngine(data.engine);
    } catch (e) {
      await s.addMessage(trip.id, botMessage(`Oops, my wings got tangled 🪶 (${e instanceof Error ? e.message : "network error"}). Want to try again?`, [text]));
    }
  }, [profile]);

  const saveProfile = useCallback(async (p: UserProfile) => {
    setProfile(p);
    await store().saveProfile(userId, p);
  }, [userId]);

  const subscribeMessages = useCallback((tripId: string, cb: (m: ChatMessage[]) => void) => {
    return storeRef.current ? storeRef.current.subscribeMessages(tripId, cb) : () => {};
  }, []);

  const value = useMemo<AppContextValue>(() => ({
    ready, storeKind, engine, uid: userId, trips, profile, tab, setTab,
    selectedTrip: trips.find((t) => t.id === selectedId),
    selectTrip, startNewTrip, deleteTrip, setStatus, applyItinerary: applyItineraryOps, subscribeMessages, sendChat, saveProfile,
  }), [ready, storeKind, engine, userId, trips, profile, tab, setTab, selectedId, selectTrip, startNewTrip, deleteTrip, setStatus, applyItineraryOps, subscribeMessages, sendChat, saveProfile]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
