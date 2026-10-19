"use client";

import { useState } from "react";
import { ArrowRight, Bell, CalendarDays, Compass, Loader2, MoreHorizontal, Sparkles, Trash2 } from "lucide-react";
import { useApp } from "@/lib/app-state";
import { HAND_PICKED } from "@/lib/mock-data";
import { formatDateRange } from "@/lib/time";
import type { Destination, Trip } from "@/lib/types";
import { IconButton, PrimaryButton, RemoteImage, StatusBadge, TagPill } from "./ui";
import { cn } from "@/lib/util";

export function HomeView() {
  const { trips, startNewTrip, selectTrip, selectedTrip, engine, storeKind, deleteTrip, setTab } = useApp();
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState(false);

  const start = async (d?: Destination) => {
    if (creating) return;
    setCreating(true);
    try { await startNewTrip(d); } finally { setCreating(false); }
  };

  return (
    <div className="space-y-8 pb-6">
      {/* Top bar */}
      <div className="flex items-center gap-2.5 px-5 pt-[max(12px,env(safe-area-inset-top))]">
        <span className="rounded-full bg-white px-2.5 py-1.5 text-[10px] font-bold tracking-widest text-ink-2 uppercase">
          {engine === "gemini" ? "Gemini" : "Offline AI"} · {storeKind === "firebase" ? "Firestore" : "This device"}
        </span>
        <div className="flex-1" />
        <IconButton aria-label="Plan with AI" onClick={() => start()}><Sparkles className="h-5 w-5 text-primary" /></IconButton>
        <IconButton aria-label="Notifications"><Bell className="h-5 w-5" fill="currentColor" /></IconButton>
        <div className="relative">
          <IconButton aria-label="More" onClick={() => setMenu((m) => !m)}><MoreHorizontal className="h-5 w-5" /></IconButton>
          {menu && (
            <div className="absolute right-0 z-20 mt-2 w-40 overflow-hidden rounded-2xl bg-white py-1 shadow-card">
              <button className="w-full px-4 py-2.5 text-left text-sm hover:bg-surface" onClick={() => { setMenu(false); setTab("profile"); }}>Profile</button>
            </div>
          )}
        </div>
      </div>

      {/* Mascot greeting */}
      <section className="mx-5 rounded-card bg-white p-6 shadow-card">
        <div className="flex items-center gap-2">
          <img src="/mascot.webp" alt="" className="h-36 w-36 shrink-0 object-contain" />
          <div className="flex-1 text-right">
            <h1 className="text-[22px] leading-tight font-bold">Where are we flying to?</h1>
            <p className="mt-1.5 text-sm text-ink-2">I&apos;ve got some great ideas!</p>
          </div>
        </div>
        <PrimaryButton className="mt-5" onClick={() => start()} disabled={creating}>
          {creating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Compass className="h-5 w-5" />} Start your next trip
        </PrimaryButton>
      </section>

      {/* Hand-picked */}
      <section>
        <div className="flex items-baseline justify-between px-5">
          <h2 className="text-[22px] font-bold">Hand-picked for you</h2>
          <span className="text-sm font-semibold text-cta">View collection</span>
        </div>
        <div className="no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 py-4">
          {HAND_PICKED.map((d) => (
            <button key={d.id} onClick={() => start(d)} aria-label={`Start a trip to ${d.destination}`}
              className="relative h-[280px] w-[220px] shrink-0 snap-start overflow-hidden rounded-[32px] text-left shadow-[0_10px_24px_rgb(0_0_0/0.15)] transition active:scale-[0.98]">
              <RemoteImage src={d.imageUrl} seed={d.id} className="absolute inset-0" />
              <div className="absolute inset-0 bg-gradient-to-b from-transparent from-40% to-black/60" />
              <div className="absolute bottom-5 left-5 space-y-2">
                <TagPill>{d.tag}</TagPill>
                <div className="text-[22px] font-bold text-white">{d.title}</div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* My itinerary */}
      <section className="space-y-5 px-5">
        <h2 className="text-[22px] font-bold">My Itinerary</h2>
        {trips.length === 0 && <p className="text-ink-2">No trips yet — tap “Start your next trip” and I&apos;ll help you plan one.</p>}
        {trips.map((t) => (
          <TripCard key={t.id} trip={t} selected={t.id === selectedTrip?.id} onOpen={() => selectTrip(t.id)}
            onDelete={() => { if (confirm(`Delete "${t.title}"?`)) deleteTrip(t.id); }} />
        ))}
      </section>
    </div>
  );
}

function TripCard({ trip, selected, onOpen, onDelete }: { trip: Trip; selected: boolean; onOpen: () => void; onDelete: () => void }) {
  return (
    <div className="relative">
      {selected && <span className="absolute top-10 bottom-10 -left-3 w-1 rounded-full bg-primary/35" />}
      <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen()}
        className={cn("group cursor-pointer overflow-hidden rounded-card bg-white shadow-card transition active:scale-[0.99]", trip.status === "past" && "opacity-70")}>
        <div className="relative h-[200px]">
          <RemoteImage src={trip.coverImageUrl} seed={trip.id} className="absolute inset-0" />
          <div className="absolute top-4 left-4"><StatusBadge status={trip.status} /></div>
          <button aria-label="Delete trip" onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-ink-2 opacity-0 backdrop-blur transition group-hover:opacity-100 focus:opacity-100">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-3 p-5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[19px] font-bold">{trip.destination ?? trip.title}</div>
            <div className="mt-2 flex items-center gap-2 text-sm text-ink-2">
              <CalendarDays className="h-4 w-4" /> {formatDateRange(trip.startDate, trip.endDate)}
            </div>
          </div>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-cta"><ArrowRight className="h-5 w-5" strokeWidth={2.6} /></span>
        </div>
      </div>
    </div>
  );
}
