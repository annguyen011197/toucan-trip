"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { BedDouble, Footprints, MapPin, TramFront } from "lucide-react";
import type { Trip } from "@/lib/types";
import { googleMapsUrl, hasLocation, travelLeg } from "@/lib/itinerary-engine";
import { displayTime } from "@/lib/time";
import { cn } from "@/lib/util";
import { useI18n } from "@/lib/i18n-react";

const TripMap = dynamic(() => import("./TripMap"), { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-surface" /> });

export function MapScreen({ trip }: { trip: Trip }) {
  const { t, lang } = useI18n();
  const [day, setDay] = useState(trip.itinerary[0]?.day ?? 1);
  const [focused, setFocused] = useState<string | undefined>();
  const items = (trip.itinerary.find((d) => d.day === day)?.items ?? []).filter(hasLocation);

  useEffect(() => {
    if (!trip.itinerary.some((d) => d.day === day)) setDay(trip.itinerary[0]?.day ?? 1);
  }, [trip.itinerary, day]);

  return (
    <div className="relative h-[calc(100dvh-76px-env(safe-area-inset-bottom))]">
      <TripMap trip={trip} day={day} focusedId={focused} onSelect={setFocused} />

      {/* Day picker */}
      <div className="no-scrollbar absolute inset-x-0 top-0 z-[500] flex gap-2 overflow-x-auto px-4 pt-[max(12px,env(safe-area-inset-top))] pb-2">
        {trip.itinerary.map((d) => (
          <button key={d.day} onClick={() => { setDay(d.day); setFocused(undefined); }}
            className={cn("shrink-0 rounded-full px-4 py-2.5 text-sm font-semibold shadow-[0_2px_8px_rgb(0_0_0/0.12)]",
              d.day === day ? "bg-primary text-white" : "bg-white text-ink")}>
            {t("map.day", { n: d.day })}
          </button>
        ))}
      </div>

      {/* Stops carousel */}
      <div className="no-scrollbar absolute inset-x-0 bottom-0 z-[500] flex gap-3 overflow-x-auto px-4 py-3">
        {trip.hotel && hasLocation(trip.hotel) && (
          <div className="flex w-[220px] shrink-0 items-center gap-3 rounded-[20px] bg-white p-3.5 shadow-card">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-tertiary text-white"><BedDouble className="h-4 w-4" /></span>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-tertiary">{t("map.yourStay")}</div>
              <div className="truncate text-[15px] font-semibold">{trip.hotel.name}</div>
            </div>
          </div>
        )}
        {items.map((it, idx) => {
          const leg = items[idx + 1] ? travelLeg(it, items[idx + 1]) : undefined;
          return (
            <div key={it.id} className={cn("flex w-[270px] shrink-0 items-center rounded-[20px] bg-white shadow-card ring-2 transition",
              focused === it.id ? "ring-primary" : "ring-transparent")}>
              <button onClick={() => setFocused(it.id)} className="flex min-w-0 flex-1 items-center gap-3 p-3.5 pr-1 text-left">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[15px] font-bold text-white">{idx + 1}</span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-primary">{displayTime(it.time, lang)}</div>
                  <div className="truncate text-[15px] font-semibold">{it.title}</div>
                  {leg && (
                    <div className="flex items-center gap-1 text-[11px] text-muted">
                      {leg.mode === "walk" ? <Footprints className="h-3 w-3" /> : <TramFront className="h-3 w-3" />} {t("map.toNext", { n: leg.minutes })}
                    </div>
                  )}
                </div>
              </button>
              <a href={googleMapsUrl(it, trip.destination)} target="_blank" rel="noopener noreferrer" aria-label={t("map.openInMaps", { title: it.title })}
                className="mr-2.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                <MapPin className="h-4 w-4" />
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
