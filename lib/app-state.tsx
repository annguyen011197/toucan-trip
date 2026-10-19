"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ChatMessage, ChatResponse, CommentStatus, ItineraryItem, ItineraryOp, ReviseResponse, Trip, TripComment, TripMember, TripStatus, UserProfile } from "./types";
import { DEFAULT_PROFILE } from "./types";
import type { TripStore } from "./store/types";
import { SupabaseStore } from "./store/supabase-store";
import { useAuth } from "./auth";
import { removeImage, uploadImage } from "./storage";
import type { PickedImage } from "./images";
import { greeting } from "./greeting";
import { applyItinerary } from "./tools";
import { uid } from "./util";
import { useI18n } from "./i18n-react";
import type { Translate } from "./i18n";
import { DEFAULT_CURRENCY } from "./currency";

export type Tab = "home" | "chat" | "itinerary" | "map" | "profile";

/** Auto-compact once this many messages pile up since the last summary. */
export const COMPACT_EVERY = 10;
/** Newest messages left as-is, so the latest reply and its quick replies stay visible. */
const COMPACT_KEEP = 2;

/** Messages a compaction would replace (everything but the newest few). */
export const compactable = (messages: ChatMessage[]) => messages.slice(0, Math.max(0, messages.length - COMPACT_KEEP));

const msg = (m: Omit<ChatMessage, "id" | "createdAt" | "quickReplies" | "cards"> & Partial<ChatMessage>): ChatMessage =>
  ({ id: uid(), createdAt: Date.now(), quickReplies: [], cards: [], ...m });

export function botMessage(text: string, quickReplies: string[] = [], cards: ChatMessage["cards"] = []): ChatMessage {
  const kind = cards[0]?.kind;
  const type: ChatMessage["type"] =
    kind === "flight" ? "flightCard" : kind === "hotel" ? "hotelCard" : kind === "place" ? "placeCard" : quickReplies.length ? "quickReplies" : "text";
  return msg({ role: "bot", type, text, quickReplies, cards });
}

const itineraryUpdateMessage = (changes: string[], t: Translate) =>
  msg({ role: "bot", type: "itineraryUpdate", text: "", cards: [{ id: uid(), kind: "itineraryUpdate", title: t("chat.itineraryUpdated"), changes }] });

interface AppContextValue {
  ready: boolean;
  engine: "gemini" | "offline" | "unknown";
  uid: string;
  trips: Trip[];
  profile: UserProfile;
  /** Currency for new trips and conversions (profile choice, else the language's default). */
  currency: string;
  tab: Tab;
  setTab: (t: Tab) => void;
  selectedTrip?: Trip;
  selectTrip: (id: string, tab?: Tab) => void;
  startNewTrip: () => Promise<void>;
  deleteTrip: (id: string) => Promise<void>;
  setStatus: (trip: Trip, status: TripStatus) => Promise<void>;
  applyItinerary: (trip: Trip, ops: ItineraryOp[]) => Promise<void>;
  subscribeMessages: (tripId: string, cb: (m: ChatMessage[]) => void) => () => void;
  sendChat: (trip: Trip, text: string, history: ChatMessage[]) => Promise<void>;
  /** Summarizes all but the newest messages and deletes the originals from the database. */
  compactChat: (trip: Trip, messages: ChatMessage[]) => Promise<void>;
  /** Translates the trip into the UI language and re-prices it in `currency` (server-side), then saves it. */
  convertTrip: (trip: Trip) => Promise<void>;
  saveProfile: (p: UserProfile) => Promise<void>;
  /** Saves an uploaded/generated image on the trip, a stop or the profile (null removes it). Replaced files are deleted. */
  setTripCover: (trip: Trip, image: PickedImage | null) => Promise<void>;
  setStopImage: (trip: Trip, itemId: string, image: PickedImage | null) => Promise<void>;
  setAvatar: (file: File) => Promise<void>;

  // ───────────── sharing ─────────────
  /** The signed-in user owns the trip (members of a shared trip can only read and comment). */
  isOwner: (trip: Trip) => boolean;
  /** Owner deletes the trip; a member leaves it. */
  removeTrip: (trip: Trip) => Promise<void>;
  subscribeComments: (tripId: string, cb: (c: TripComment[]) => void) => () => void;
  addComment: (trip: Trip, item: ItineraryItem, day: number, text: string) => Promise<void>;
  deleteComment: (comment: TripComment) => Promise<void>;
  reviewComments: (trip: Trip, ids: string[], status: CommentStatus) => Promise<void>;
  /** Owner: revises the itinerary from approved comments with AI, saves it and marks them applied. */
  applyComments: (trip: Trip, comments: TripComment[]) => Promise<ReviseResponse>;
  listMembers: (trip: Trip) => Promise<TripMember[]>;
  inviteMember: (trip: Trip, email: string) => Promise<{ member: TripMember; existing: boolean }>;
  removeMember: (member: TripMember) => Promise<void>;
  /** Owner: the share link, if link sharing is on. */
  getShareLink: (trip: Trip) => Promise<string | undefined>;
  /** Owner: turns link sharing on with a new link (old ones stop working) or off. */
  resetShareLink: (trip: Trip, enabled: boolean) => Promise<string | undefined>;
}

const AppContext = createContext<AppContextValue | null>(null);

const SELECTED_KEY = "toucan-trip:selected";
/** Share links open the app with `?join=<token>`. */
const JOIN_PARAM = "join";

const shareUrl = (token: string) => `${window.location.origin}/?${JOIN_PARAM}=${encodeURIComponent(token)}`;

export function AppProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const { user, idToken } = useAuth();
  const { lang, setLang, t } = useI18n();
  const storeRef = useRef<TripStore | null>(null);
  const [ready, setReady] = useState(false);
  const [engine, setEngine] = useState<AppContextValue["engine"]>("unknown");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [tab, setTabState] = useState<Tab>("home");
  const [selectedId, setSelectedId] = useState<string | undefined>();

  useEffect(() => {
    const store = new SupabaseStore(userId);
    storeRef.current = store;
    let cancelled = false;
    let off: (() => void) | undefined;
    (async () => {
      const saved = await store.getProfile();
      if (cancelled) return;
      setProfile({ ...DEFAULT_PROFILE, ...saved, name: saved?.name || user?.displayName || "" });
      if (saved?.language) setLang(saved.language);
      try { setSelectedId(localStorage.getItem(SELECTED_KEY) ?? undefined); } catch { /* ignore */ }
      let first = true;
      off = store.subscribeTrips((t) => {
        setTrips(t);
        if (first) { first = false; setReady(true); }
      });
    })().catch((e) => { console.error(e); setReady(true); });
    fetch("/api/chat").then((r) => r.json()).then((j) => setEngine(j.engine)).catch(() => setEngine("offline"));
    return () => { cancelled = true; off?.(); store.dispose(); };
  }, [userId]); // `user` only seeds the default name; setLang is stable

  const currency = profile.currency ?? DEFAULT_CURRENCY[lang];

  // Share link: join the trip once signed in, open it, and drop the token from the address bar.
  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    const token = url.searchParams.get(JOIN_PARAM);
    if (!token) return;
    url.searchParams.delete(JOIN_PARAM);
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    (async () => {
      const res = await fetch("/api/trips/join", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => ({}))) as { tripId?: string; error?: string };
      if (!res.ok || !data.tripId) throw new Error(data.error || `HTTP ${res.status}`);
      await storeRef.current?.refreshTrips();
      setSelectedId(data.tripId);
      setTab("itinerary");
    })().catch((e) => alert(t("share.joinFailed", { error: e instanceof Error ? e.message : String(e) })));
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps -- once, after the first trip load

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

  const startNewTrip = useCallback(async () => {
    const now = Date.now();
    const trip: Trip = {
      id: uid(), ownerId: userId, title: t("common.newTrip"), status: "dreaming", itinerary: [], currency, language: lang, createdAt: now, updatedAt: now,
    };
    await store().saveTrip(trip);
    const hello = greeting(trip, profile, lang);
    await store().addMessage(trip.id, botMessage(hello.text, hello.quickReplies));
    setSelectedId(trip.id);
    setTab("chat");
  }, [userId, profile, setTab, currency, lang, t]);

  const deleteTrip = useCallback(async (id: string) => {
    const trip = trips.find((t) => t.id === id);
    await store().deleteTrip(id);
    if (!trip) return;
    const images = [trip.coverImageUrl, ...trip.itinerary.flatMap((d) => d.items.map((i) => i.imageUrl))];
    await Promise.all(images.map(removeImage)); // ignores URLs we didn't store (e.g. Wikimedia)
  }, [trips]);

  const setStatus = useCallback(async (trip: Trip, status: TripStatus) => {
    await store().saveTrip({ ...trip, status, updatedAt: Date.now() });
  }, []);

  /** Itinerary-tab edits: same engine as chat, and the bot posts the itineraryUpdate card. */
  const applyItineraryOps = useCallback(async (trip: Trip, ops: ItineraryOp[]) => {
    const { trip: next, result } = applyItinerary(trip, ops, lang);
    await store().saveTrip(next);
    if (result.changes.length) await store().addMessage(trip.id, itineraryUpdateMessage(result.changes, t));
  }, [lang, t]);

  const sendChat = useCallback(async (trip: Trip, text: string, history: ChatMessage[]) => {
    const s = store();
    // Nothing to convert yet: an empty plan just adopts the current language and currency.
    if (!trip.itinerary.length) trip = { ...trip, language: lang, currency };
    await s.addMessage(trip.id, msg({ role: "user", type: "text", text }));
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
        body: JSON.stringify({ text, trip, history: history.slice(-30), profile, lang }),
      });
      const data = (await res.json()) as ChatResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await s.saveTrip(data.trip);
      // Update card first, so the reply (with its chips) is always the latest message.
      if (data.itineraryChanges.length) await s.addMessage(trip.id, itineraryUpdateMessage(data.itineraryChanges, t));
      await s.addMessage(trip.id, botMessage(data.text, data.quickReplies, data.cards));
      setEngine(data.engine);
    } catch (e) {
      await s.addMessage(trip.id, botMessage(t("chat.error", { error: e instanceof Error ? e.message : t("chat.networkError") }), [text]));
    }
  }, [profile, idToken, lang, currency, t]);

  const compactChat = useCallback(async (trip: Trip, messages: ChatMessage[]) => {
    const old = compactable(messages);
    if (old.length < 2) return;
    const res = await fetch("/api/chat/compact", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
      body: JSON.stringify({ trip, messages: old, lang }),
    });
    const data = (await res.json()) as { text?: string; error?: string };
    if (!res.ok || !data.text) throw new Error(data.error || `HTTP ${res.status}`);
    await store().compactMessages(trip.id, old.map((m) => m.id), msg({ role: "bot", type: "summary", text: data.text }));
  }, [idToken, lang]);

  const convertTrip = useCallback(async (trip: Trip) => {
    const res = await fetch("/api/trips/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
      body: JSON.stringify({ trip, language: lang, currency }),
    });
    const data = (await res.json()) as { trip?: Trip; error?: string };
    if (!res.ok || !data.trip) throw new Error(data.error || `HTTP ${res.status}`);
    await store().saveTrip(data.trip);
  }, [idToken, lang, currency]);

  const saveProfile = useCallback(async (p: UserProfile) => {
    setProfile(p);
    if (p.language) setLang(p.language);
    await store().saveProfile(p);
  }, [setLang]);

  const setTripCover = useCallback(async (trip: Trip, image: PickedImage | null) => {
    await store().saveTrip({ ...trip, coverImageUrl: image?.url, updatedAt: Date.now() });
    if (trip.coverImageUrl !== image?.url) await removeImage(trip.coverImageUrl);
  }, []);

  const setStopImage = useCallback(async (trip: Trip, itemId: string, image: PickedImage | null) => {
    const old = trip.itinerary.flatMap((d) => d.items).find((i) => i.id === itemId)?.imageUrl;
    const itinerary = trip.itinerary.map((d) => ({
      ...d,
      // imageSearched: a removed photo shouldn't be replaced by the Wikipedia lookup on the next turn.
      items: d.items.map((i) => (i.id === itemId ? { ...i, imageUrl: image?.url, imageCredit: image?.credit, imageSearched: true } : i)),
    }));
    await store().saveTrip({ ...trip, itinerary, updatedAt: Date.now() });
    if (old !== image?.url) await removeImage(old);
  }, []);

  const setAvatar = useCallback(async (file: File) => {
    const url = await uploadImage(userId, "avatars", file);
    const previous = profile.avatarUrl;
    await saveProfile({ ...profile, avatarUrl: url });
    await removeImage(previous);
  }, [userId, profile, saveProfile]);

  const subscribeMessages = useCallback((tripId: string, cb: (m: ChatMessage[]) => void) => {
    return storeRef.current ? storeRef.current.subscribeMessages(tripId, cb) : () => {};
  }, []);

  // ───────────── sharing ─────────────

  const isOwner = useCallback((trip: Trip) => trip.ownerId === userId, [userId]);

  const removeTrip = useCallback(async (trip: Trip) => {
    if (trip.ownerId === userId) return deleteTrip(trip.id);
    const me = (await store().listMembers(trip.id)).find((m) => m.userId === userId);
    if (me) await store().removeMember(me);
  }, [userId, deleteTrip]);

  const subscribeComments = useCallback((tripId: string, cb: (c: TripComment[]) => void) => {
    return storeRef.current ? storeRef.current.subscribeComments(tripId, cb) : () => {};
  }, []);

  const addComment = useCallback(async (trip: Trip, item: ItineraryItem, day: number, text: string) => {
    await store().addComment({
      id: uid(), tripId: trip.id, itemId: item.id, day, itemTitle: item.title, authorId: userId,
      authorName: profile.name || user?.displayName || user?.email?.split("@")[0] || "", text, status: "open", createdAt: Date.now(),
    });
  }, [userId, profile.name, user]);

  const deleteComment = useCallback((comment: TripComment) => store().deleteComment(comment), []);

  const reviewComments = useCallback((trip: Trip, ids: string[], status: CommentStatus) => store().setCommentStatus(trip.id, ids, status), []);

  const applyComments = useCallback(async (trip: Trip, comments: TripComment[]) => {
    const res = await fetch("/api/trips/revise", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
      body: JSON.stringify({ trip, comments, lang }),
    });
    const data = (await res.json()) as ReviseResponse & { error?: string };
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const s = store();
    await s.saveTrip(data.trip);
    await s.setCommentStatus(trip.id, data.appliedIds, "applied");
    // Same trail as chat edits, so the owner's planning chat knows what changed and why.
    if (data.itineraryChanges.length) await s.addMessage(trip.id, itineraryUpdateMessage(data.itineraryChanges, t));
    if (data.text) await s.addMessage(trip.id, botMessage(data.text));
    setEngine(data.engine);
    return data;
  }, [idToken, lang, t]);

  const listMembers = useCallback((trip: Trip) => store().listMembers(trip.id), []);

  const inviteMember = useCallback(async (trip: Trip, email: string) => {
    const res = await fetch("/api/trips/members", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
      body: JSON.stringify({ tripId: trip.id, email }),
    });
    const data = (await res.json().catch(() => ({}))) as { member?: Record<string, unknown>; existing?: boolean; error?: string };
    if (!res.ok || !data.member) throw new Error(data.error || `HTTP ${res.status}`);
    // The route returns the raw row; re-read so it's mapped like the rest of the list.
    const member = (await store().listMembers(trip.id)).find((m) => m.id === data.member!.id);
    if (!member) throw new Error(t("common.somethingWrong"));
    return { member, existing: !!data.existing };
  }, [idToken, t]);

  const removeMember = useCallback((member: TripMember) => store().removeMember(member), []);

  const getShareLink = useCallback(async (trip: Trip) => {
    const token = await store().getShareToken(trip.id);
    return token && shareUrl(token);
  }, []);

  const resetShareLink = useCallback(async (trip: Trip, enabled: boolean) => {
    const token = await store().resetShareToken(trip.id, enabled);
    return token && shareUrl(token);
  }, []);

  const value = useMemo<AppContextValue>(() => ({
    ready, engine, uid: userId, trips, profile, currency, tab, setTab,
    selectedTrip: trips.find((tr) => tr.id === selectedId),
    selectTrip, startNewTrip, deleteTrip, setStatus, applyItinerary: applyItineraryOps, subscribeMessages, sendChat, compactChat, convertTrip, saveProfile, setTripCover, setStopImage, setAvatar,
    isOwner, removeTrip, subscribeComments, addComment, deleteComment, reviewComments, applyComments, listMembers, inviteMember, removeMember, getShareLink, resetShareLink,
  }), [ready, engine, userId, trips, profile, currency, tab, setTab, selectedId, selectTrip, startNewTrip, deleteTrip, setStatus, applyItineraryOps, subscribeMessages, sendChat, compactChat, convertTrip, saveProfile, setTripCover, setStopImage, setAvatar,
    isOwner, removeTrip, subscribeComments, addComment, deleteComment, reviewComments, applyComments, listMembers, inviteMember, removeMember, getShareLink, resetShareLink]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
