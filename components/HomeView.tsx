"use client";

import { useState } from "react";
import { ArrowRight, Bell, CalendarDays, Compass, Loader2, MoreHorizontal, Sparkles, Trash2 } from "lucide-react";
import { useApp } from "@/lib/app-state";
import { formatDateRange } from "@/lib/time";
import type { Trip } from "@/lib/types";
import { IconButton, PrimaryButton, RemoteImage, StatusBadge } from "./ui";
import { cn } from "@/lib/util";
import { useI18n } from "@/lib/i18n-react";

export function HomeView() {
  const { trips, startNewTrip, selectTrip, selectedTrip, engine, deleteTrip, setTab } = useApp();
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState(false);

  const start = async () => {
    if (creating) return;
    setCreating(true);
    try { await startNewTrip(); } finally { setCreating(false); }
  };

  return (
    <div className="space-y-8 pb-6">
      {/* Top bar */}
      <div className="flex items-center gap-2.5 px-5 pt-[max(12px,env(safe-area-inset-top))]">
        <span className="rounded-full bg-white px-2.5 py-1.5 text-[10px] font-bold tracking-widest text-ink-2 uppercase">
          {engine === "gemini" ? "Gemini" : t("home.offlineAi")}
        </span>
        <div className="flex-1" />
        <IconButton aria-label={t("home.planWithAi")} onClick={() => start()}><Sparkles className="h-5 w-5 text-primary" /></IconButton>
        <IconButton aria-label={t("home.notifications")}><Bell className="h-5 w-5" fill="currentColor" /></IconButton>
        <div className="relative">
          <IconButton aria-label={t("common.more")} onClick={() => setMenu((m) => !m)}><MoreHorizontal className="h-5 w-5" /></IconButton>
          {menu && (
            <div className="absolute right-0 z-20 mt-2 w-40 overflow-hidden rounded-2xl bg-white py-1 shadow-card">
              <button className="w-full px-4 py-2.5 text-left text-sm hover:bg-surface" onClick={() => { setMenu(false); setTab("profile"); }}>{t("tab.profile")}</button>
            </div>
          )}
        </div>
      </div>

      {/* Mascot greeting */}
      <section className="mx-5 rounded-card bg-white p-6 shadow-card">
        <div className="flex items-center gap-2">
          <img src="/mascot.webp" alt="" className="h-36 w-36 shrink-0 object-contain" />
          <div className="flex-1 text-right">
            <h1 className="text-[22px] leading-tight font-bold">{t("home.heading")}</h1>
            <p className="mt-1.5 text-sm text-ink-2">{t("home.subheading")}</p>
          </div>
        </div>
        <PrimaryButton className="mt-5" onClick={() => start()} disabled={creating}>
          {creating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Compass className="h-5 w-5" />} {t("common.startNextTrip")}
        </PrimaryButton>
      </section>

      {/* My itinerary */}
      <section className="space-y-5 px-5">
        <h2 className="text-[22px] font-bold">{t("home.myItinerary")}</h2>
        {trips.length === 0 && <p className="text-ink-2">{t("home.noTrips")}</p>}
        {trips.map((tr) => (
          <TripCard key={tr.id} trip={tr} selected={tr.id === selectedTrip?.id} onOpen={() => selectTrip(tr.id)}
            onDelete={() => { if (confirm(t("home.confirmDelete", { title: tr.title }))) deleteTrip(tr.id); }} />
        ))}
      </section>
    </div>
  );
}

function TripCard({ trip, selected, onOpen, onDelete }: { trip: Trip; selected: boolean; onOpen: () => void; onDelete: () => void }) {
  const { t, lang } = useI18n();
  return (
    <div className="relative">
      {selected && <span className="absolute top-10 bottom-10 -left-3 w-1 rounded-full bg-primary/35" />}
      <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen()}
        className={cn("group cursor-pointer overflow-hidden rounded-card bg-white shadow-card transition active:scale-[0.99]", trip.status === "past" && "opacity-70")}>
        <div className="relative h-[200px]">
          <RemoteImage src={trip.coverImageUrl} seed={trip.id} className="absolute inset-0" />
          <div className="absolute top-4 left-4"><StatusBadge status={trip.status} /></div>
          <button aria-label={t("home.deleteTrip")} onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-ink-2 opacity-0 backdrop-blur transition group-hover:opacity-100 focus:opacity-100">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-3 p-5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[19px] font-bold">{trip.destination ?? trip.title}</div>
            <div className="mt-2 flex items-center gap-2 text-sm text-ink-2">
              <CalendarDays className="h-4 w-4" /> {formatDateRange(trip.startDate, trip.endDate, lang)}
            </div>
          </div>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-cta"><ArrowRight className="h-5 w-5" strokeWidth={2.6} /></span>
        </div>
      </div>
    </div>
  );
}
