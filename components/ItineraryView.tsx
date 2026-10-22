"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, Camera, Check, ChevronRight, Footprints, Languages, ImagePlus, GripVertical, Lightbulb, Map as MapIcon, MapPin, MessageCircle, MoreVertical, Share2, SquareArrowOutUpRight, TramFront, UserPlus, Users, WandSparkles, X } from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useApp } from "@/lib/app-state";
import { TRIP_STATUSES, type ItineraryItem, type Trip, type TripComment } from "@/lib/types";
import { dayCost, googleMapsUrl, travelLeg } from "@/lib/itinerary-engine";
import { findCity } from "@/lib/mock-data";
import { displayTime, formatDateRange, formatLongDate } from "@/lib/time";
import { cn } from "@/lib/util";
import { money } from "@/lib/currency";
import { useI18n } from "@/lib/i18n-react";
import { PrimaryButton, RemoteImage } from "./ui";
import { shareTrip } from "./ChatView";
import { ImagePicker } from "./ImagePicker";
import { ConvertDialog, conversionFor, type Conversion } from "./ConvertDialog";
import { ShareSheet } from "./ShareSheet";
import { ReviewSheet, StopComments, useTripComments } from "./Comments";
import { ExpenseSummaryCard, ExpensesSheet, StopExpenseButton, ownerNameFrom, useExpenseSummary, useTripExpenses, type ExpenseDraft } from "./Expenses";
import { TravelersCard, TravelersSheet, travelerCount, useTripTravelers } from "./Travelers";
import { expenseDraftFor } from "@/lib/expenses";

const DISMISSED_KEY = "toucan-trip:convert-dismissed";

/** Convert offers the user said "Not now" to, per trip + target (this device only). */
function readDismissed(): string[] {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]") as string[]; } catch { return []; }
}

const TripMap = dynamic(() => import("./TripMap"), { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-surface" /> });

export function ItineraryView({ trip }: { trip: Trip }) {
  const { setTab, applyItinerary, setStatus, setTripCover, setStopImage, currency, convertTrip, isOwner, profile } = useApp();
  const { t, lang } = useI18n();
  // Members of a shared trip only read and comment; every edit control is the owner's.
  const owner = isOwner(trip);
  const comments = useTripComments(trip.id);
  const [picker, setPicker] = useState<{ kind: "cover" } | { kind: "stop"; item: ItineraryItem }>();
  const expenses = useTripExpenses(trip.id);
  const spent = useExpenseSummary(trip, expenses);
  const travelers = useTripTravelers(trip.id);
  const groupSize = travelers.length ? travelerCount(trip, travelers) : trip.travelers ?? 1;
  const ownerName = owner ? profile.name || t("share.you") : ownerNameFrom(trip, expenses) || t("expense.owner");
  const [sheet, setSheet] = useState<{ kind: "share" } | { kind: "review" } | { kind: "comments"; item: ItineraryItem; day: number }
    | { kind: "expenses"; draft?: ExpenseDraft } | { kind: "travelers" }>();
  const toReview = comments.filter((c) => c.status === "open").length;
  const approved = comments.filter((c) => c.status === "approved").length;
  const [selectedDay, setSelectedDay] = useState(1);
  const [menu, setMenu] = useState(false);
  const day = trip.itinerary.find((d) => d.day === selectedDay);
  const city = findCity(trip.destination);

  // Offer to convert a plan made in another language/currency: a popup once, then a button under the hero.
  const conversion = owner && trip.itinerary.length ? conversionFor(trip, lang, currency) : undefined;
  const [dismissed, setDismissed] = useState(readDismissed);
  // The offer being shown. Held apart from `conversion`: saving updates the trip optimistically, which clears
  // `conversion` mid-save, and a failed save must keep the dialog (and its error) open.
  const [offer, setOffer] = useState<Conversion>();
  useEffect(() => { if (conversion && !dismissed.includes(conversion.key)) setOffer(conversion); }, [conversion?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const closeConvert = () => {
    setOffer(undefined);
    if (!offer || dismissed.includes(offer.key)) return;
    const next = [...dismissed, offer.key].slice(-50);
    setDismissed(next);
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!trip.itinerary.some((d) => d.day === selectedDay)) setSelectedDay(trip.itinerary[0]?.day ?? 1);
  }, [trip.itinerary, selectedDay]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    if (!day || !e.over || e.active.id === e.over.id) return;
    const to = day.items.findIndex((i) => i.id === e.over!.id);
    applyItinerary(trip, [{ action: "move", day: day.day, itemId: String(e.active.id), toDay: day.day, toIndex: to }]);
  };

  const place = trip.destination ?? trip.title;

  const remove = (item: ItineraryItem) => applyItinerary(trip, [{ action: "remove", day: selectedDay, itemId: item.id }]);

  return (
    <div className="min-h-dvh bg-white">
      {/* Nav */}
      <header className="sticky top-0 z-[500] flex items-center border-b border-line/70 bg-white/95 px-3 pt-[max(8px,env(safe-area-inset-top))] pb-2 backdrop-blur">
        <button aria-label={t("common.back")} onClick={() => setTab("home")} className="flex h-10 w-10 items-center justify-center"><ArrowLeft className="h-5 w-5" /></button>
        <div className="flex-1 text-center">
          <div className="text-[17px] font-bold">{trip.title}</div>
          <div className="text-[11px] font-semibold tracking-[0.15em] text-primary">{t(owner ? "itin.aiGenerated" : "itin.sharedWithYou")}</div>
        </div>
        {!owner ? <div className="w-10" /> : <div className="relative">
          <button aria-label={t("itin.tripStatus")} onClick={() => setMenu((m) => !m)} className="flex h-10 w-10 items-center justify-center"><MoreVertical className="h-5 w-5" /></button>
          {menu && (
            <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-2xl bg-white py-1 shadow-card ring-1 ring-line/60">
              <div className="px-4 pt-2 pb-1 text-[11px] font-bold tracking-widest text-muted uppercase">{t("itin.status")}</div>
              {TRIP_STATUSES.map((s) => (
                <button key={s} onClick={() => { setMenu(false); setStatus(trip, s); }}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-surface">
                  {t(`status.${s}`)} {trip.status === s && <Check className="h-4 w-4 text-primary" />}
                </button>
              ))}
            </div>
          )}
        </div>}
      </header>

      <div className="space-y-5 pt-4" onClick={() => menu && setMenu(false)}>
        {/* Hero */}
        <div className="relative mx-5 h-[180px] overflow-hidden rounded-card shadow-[0_6px_16px_rgb(0_0_0/0.12)]">
          <RemoteImage src={trip.coverImageUrl} seed={trip.id} className="absolute inset-0" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent from-30% to-black/60" />
          {owner && (
            <button aria-label={t("itin.changeCover")} onClick={() => setPicker({ kind: "cover" })}
              className="absolute top-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-ink-2 backdrop-blur">
              <Camera className="h-4 w-4" />
            </button>
          )}
          <div className="absolute bottom-4 left-5 text-white">
            <div className="text-2xl font-bold">{trip.destination ?? t("common.destinationTbd")}</div>
            <div className="text-sm opacity-90">{formatDateRange(trip.startDate, trip.endDate, lang).replace(" - ", " — ")}</div>
          </div>
        </div>

        {owner ? (
          <div className="mx-5 flex gap-3">
            <PrimaryButton color="primary" onClick={() => setTab("chat")}><WandSparkles className="h-5 w-5" /> {t("itin.continue")}</PrimaryButton>
            <button aria-label={t("share.title")} onClick={() => setSheet({ kind: "share" })} className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary"><UserPlus className="h-5 w-5" /></button>
          </div>
        ) : (
          <div className="mx-5 flex items-center gap-3 rounded-card bg-primary-soft/60 p-4">
            <Users className="h-5 w-5 shrink-0 text-primary" />
            <p className="flex-1 text-sm text-ink-2">{t("itin.commenterHint")}</p>
            <button aria-label={t("common.share")} onClick={() => shareTrip(trip, lang)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-primary"><Share2 className="h-4 w-4" /></button>
          </div>
        )}

        {owner && (toReview > 0 || approved > 0) && (
          <button onClick={() => setSheet({ kind: "review" })}
            className="mx-5 flex w-[calc(100%-40px)] items-center gap-3 rounded-card border border-amber-200 bg-amber-50 p-4 text-left">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-amber-700"><MessageCircle className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{toReview ? t("itin.reviewCount", { n: toReview }) : t("itin.approvedCount", { n: approved })}</span>
              <span className="block text-xs text-ink-2">{toReview ? t("itin.reviewHint") : t("itin.applyHint")}</span>
            </span>
            <ChevronRight className="h-5 w-5 text-muted" />
          </button>
        )}

        {conversion && !offer && (
          <button onClick={() => setOffer(conversion)}
            className="mx-5 flex w-[calc(100%-40px)] items-center justify-center gap-2 rounded-full border border-primary/25 bg-primary-soft/60 py-2.5 text-sm font-semibold text-primary">
            <Languages className="h-4 w-4" /> {t("convert.offer", { target: conversion.target })}
          </button>
        )}

        {trip.itinerary.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-8 py-8 text-center">
            <img src="/mascot.webp" alt="" className="w-28" />
            <div className="font-semibold">{t("itin.blankTitle")}</div>
            <p className="text-sm text-ink-2">{t("itin.blankMessage")}</p>
          </div>
        ) : (
          <>
            {/* Day tabs */}
            <div className="no-scrollbar flex gap-2.5 overflow-x-auto px-5">
              {trip.itinerary.map((d) => (
                <button key={d.day} onClick={() => setSelectedDay(d.day)} aria-pressed={d.day === selectedDay}
                  className={cn("flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl transition",
                    d.day === selectedDay ? "bg-primary text-white shadow-[0_6px_14px_rgb(26_127_232/0.35)]" : "bg-surface text-ink-2")}>
                  <span className="text-[10px] font-semibold tracking-widest">{t("itin.day")}</span>
                  <span className="text-xl font-bold">{String(d.day).padStart(2, "0")}</span>
                </button>
              ))}
            </div>

            <div className="border-t border-line px-5 pt-5">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">{t("itin.daily")}</h2>
                <button onClick={() => setTab("map")} className="flex items-center gap-1.5 text-sm font-semibold text-primary"><MapIcon className="h-4 w-4" fill="currentColor" fillOpacity={0.2} /> {t("itin.viewRoute")}</button>
              </div>
              {day?.date && <div className="mt-1 text-[13px] text-ink-2">{formatLongDate(day.date, lang)}</div>}
              <div className="mt-0.5 text-xs text-muted">{t(owner ? "itin.dragHint" : "itin.commentHint")}</div>
            </div>

            {/* Timeline */}
            <div className="px-5">
              {day && day.items.length > 0 ? (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext items={day.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                    {day.items.map((item, idx) => (
                      <TimelineRow key={item.id} item={item} first={idx === 0} last={idx === day.items.length - 1}
                        next={day.items[idx + 1]} destination={trip.destination} currency={trip.currency} editable={owner}
                        comments={comments.filter((c) => c.itemId === item.id)} onRemove={() => remove(item)}
                        onImage={() => setPicker({ kind: "stop", item })} onComments={() => setSheet({ kind: "comments", item, day: day.day })}
                        spent={spent.byItem[item.id]} onExpense={() => setSheet({ kind: "expenses", draft: expenseDraftFor(item, day.day, trip.currency) })} />
                    ))}
                  </SortableContext>
                </DndContext>
              ) : (
                <p className="py-6 text-sm text-ink-2">{t("itin.nothingToday")}</p>
              )}
            </div>

            {/* Cost */}
            <div className="mx-5 rounded-card bg-surface p-[18px]">
              <div className="flex justify-between">
                <div>
                  <div className="text-[11px] font-bold tracking-widest text-ink-2">{t("itin.dayEst", { n: selectedDay })}</div>
                  <div className="text-xl font-bold">{money(dayCost(day), trip.currency, lang)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-bold tracking-widest text-ink-2">{t("itin.total")}</div>
                  <div className="text-xl font-bold text-primary">{money(trip.itinerary.reduce((s, d) => s + dayCost(d), 0), trip.currency, lang)}</div>
                </div>
              </div>
              <div className="mt-2 text-[11px] text-muted">{t("itin.costNote")}</div>
            </div>
          </>
        )}

        <TravelersCard trip={trip} travelers={travelers} ownerName={ownerName} onOpen={() => setSheet({ kind: "travelers" })} />
        <ExpenseSummaryCard trip={trip} summary={spent} count={expenses.length} groupSize={groupSize} onOpen={() => setSheet({ kind: "expenses" })} />

        {city?.tip && (
          <div className="mx-5 rounded-card border border-primary/12 bg-primary-soft/60 p-5">
            <div className="flex items-center gap-2 font-semibold text-primary"><Lightbulb className="h-5 w-5" fill="currentColor" fillOpacity={0.25} /> {t("itin.tip")}</div>
            <p className="mt-2.5 text-sm leading-relaxed text-ink-2 italic">“{city.tip}”</p>
          </div>
        )}

        {day && day.items.length > 0 && (
          <div className="relative mx-5 mb-6 h-[170px] overflow-hidden rounded-card">
            <div className="pointer-events-none absolute inset-0 grayscale-[70%]">
              <TripMap trip={trip} day={selectedDay} interactive={false} />
            </div>
            <button onClick={() => setTab("map")}
              className="absolute top-1/2 left-1/2 z-[450] flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-ink px-5 py-3 text-[15px] font-semibold text-white">
              <SquareArrowOutUpRight className="h-4 w-4" /> {t("itin.exploreMap")}
            </button>
          </div>
        )}
      </div>

      {sheet?.kind === "share" && <ShareSheet trip={trip} onClose={() => setSheet(undefined)} />}
      {sheet?.kind === "review" && <ReviewSheet trip={trip} comments={comments} onClose={() => setSheet(undefined)} />}
      {sheet?.kind === "comments" && (
        <StopComments trip={trip} item={sheet.item} day={sheet.day} comments={comments} onClose={() => setSheet(undefined)} />
      )}
      {sheet?.kind === "expenses" && (
        <ExpensesSheet trip={trip} expenses={expenses} travelers={travelers} summary={spent} draft={sheet.draft} onClose={() => setSheet(undefined)} />
      )}
      {sheet?.kind === "travelers" && (
        <TravelersSheet trip={trip} travelers={travelers} ownerName={ownerName} onClose={() => setSheet(undefined)} />
      )}
      {offer && (
        <ConvertDialog trip={trip} conversion={offer} onClose={closeConvert}
          onConvert={async () => { await convertTrip(trip); setOffer(undefined); }} />
      )}
      {picker?.kind === "cover" && (
        <ImagePicker title={t("itin.tripCover")} folder="covers" current={trip.coverImageUrl} onClose={() => setPicker(undefined)}
          defaultPrompt={t("itin.coverPrompt", { place })} onPick={(img) => setTripCover(trip, img)} />
      )}
      {picker?.kind === "stop" && (
        <ImagePicker title={picker.item.title} folder="stops" current={picker.item.imageUrl} onClose={() => setPicker(undefined)}
          defaultPrompt={[picker.item.title, trip.destination].filter(Boolean).join(", ")}
          onPick={(img) => setStopImage(trip, picker.item.id, img)} />
      )}
    </div>
  );
}

function TimelineRow({ item, first, last, next, destination, currency, editable, comments, spent, onRemove, onImage, onComments, onExpense }: {
  item: ItineraryItem; first: boolean; last: boolean; next?: ItineraryItem; destination?: string; currency: string;
  /** Owner: drag, photo and remove controls. */
  editable: boolean;
  comments: TripComment[];
  /** Actually spent at this stop, in the trip currency. */
  spent?: number;
  onRemove: () => void; onImage: () => void; onComments: () => void; onExpense: () => void;
}) {
  const { t, lang } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !editable });
  const unresolved = comments.filter((c) => c.status === "open" || c.status === "approved").length;
  const leg = next ? travelLeg(item, next) : undefined;
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("group relative flex gap-3.5 bg-white", isDragging && "z-10 rounded-2xl shadow-card")}>
      {/* Rail */}
      <div className="flex w-[18px] shrink-0 flex-col items-center">
        <span className={cn("mt-1 h-3.5 w-3.5 rounded-full", first ? "bg-primary ring-[5px] ring-primary/25" : "bg-[#CBD5E1]")} />
        <span className={cn("w-0.5 flex-1", last ? "bg-transparent" : "bg-line")} />
      </div>
      <div className={cn("min-w-0 flex-1", last ? "pb-4" : "pb-6")} {...attributes} {...listeners} style={{ touchAction: "manipulation" }}>
        <div className="flex items-center gap-2">
          <span className={cn("text-xs font-semibold", first ? "text-primary" : "text-muted")}>{displayTime(item.time, lang)}</span>
          {editable && <GripVertical className="h-3.5 w-3.5 text-muted/60" />}
          <span className="flex-1" />
          {item.estCost > 0 && <span className="text-xs font-medium text-ink-2">{money(item.estCost, currency, lang)}</span>}
          <StopExpenseButton spent={spent} currency={currency} title={item.title} onClick={onExpense} />
          <button aria-label={t("itin.commentsFor", { title: item.title, n: comments.length })} onPointerDown={(e) => e.stopPropagation()} onClick={onComments}
            className={cn("flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-full px-1 text-[11px] font-bold",
              unresolved ? "bg-amber-100 text-amber-800" : "text-muted hover:bg-surface hover:text-ink")}>
            <MessageCircle className="h-3.5 w-3.5" />{comments.length > 0 && comments.length}
          </button>
          {editable && (
            <>
              <button aria-label={t("itin.photoFor", { title: item.title })} onPointerDown={(e) => e.stopPropagation()} onClick={onImage}
                className="flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink">
                <ImagePlus className="h-3.5 w-3.5" />
              </button>
              <button aria-label={t("itin.remove", { title: item.title })} onPointerDown={(e) => e.stopPropagation()} onClick={onRemove}
                className="flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink">
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
        <div className="mt-1 text-base font-semibold">{item.title}</div>
        <a href={googleMapsUrl(item, destination)} target="_blank" rel="noopener noreferrer" onPointerDown={(e) => e.stopPropagation()}
          className="mt-1 flex w-fit max-w-full items-start gap-1 text-[13px] font-medium text-primary hover:underline">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">{item.address ?? t("itin.openMaps")}</span>
        </a>
        {item.note && <p className="mt-1 text-sm leading-relaxed text-ink-2">{item.note}</p>}
        {item.tips?.length ? (
          <div className="mt-2 rounded-xl bg-primary-soft/60 px-3 py-2">
            <div className="flex items-center gap-1 text-[11px] font-bold tracking-wider text-cta uppercase">
              <Lightbulb className="h-3.5 w-3.5" /> {t("itin.prepTips")}
            </div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px] leading-snug text-ink-2">
              {item.tips.map((tip, i) => <li key={i}>{tip}</li>)}
            </ul>
          </div>
        ) : null}
        {item.imageUrl && <RemoteImage src={item.imageUrl} seed={item.id} alt={item.title} className="mt-2.5 h-[120px] rounded-2xl" />}
        {item.imageUrl && item.imageCredit && (item.imageCredit.url ? (
          <a href={item.imageCredit.url} target="_blank" rel="noopener noreferrer" onPointerDown={(e) => e.stopPropagation()}
            className="mt-1 block truncate text-[11px] text-muted hover:underline">{item.imageCredit.text}</a>
        ) : <div className="mt-1 truncate text-[11px] text-muted">{item.imageCredit.text}</div>)}
        {item.tags?.length ? (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {item.tags.map((t) => <span key={t} className="rounded-full bg-primary-soft px-2.5 py-1 text-[10px] font-bold tracking-wider text-cta uppercase">{t}</span>)}
          </div>
        ) : null}
        {leg && (
          <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-muted">
            {leg.mode === "walk" ? <Footprints className="h-3.5 w-3.5" /> : <TramFront className="h-3.5 w-3.5" />}
            {t(leg.mode === "walk" ? "itin.leg.walk" : "itin.leg.transit", { n: leg.minutes })}
          </div>
        )}
      </div>
    </div>
  );
}
