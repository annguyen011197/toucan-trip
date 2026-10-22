"use client";

import { useState, type FormEvent } from "react";
import { CalendarArrowUp, Check, CircleSlash, Clock, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useApp } from "@/lib/app-state";
import { ITEM_CATEGORIES, type ItemCategory, type ItineraryItem, type ItineraryItemPatch, type ItineraryOp, type Trip } from "@/lib/types";
import { parseAmount } from "@/lib/expenses";
import { minutesOf, normalizeTime } from "@/lib/time";
import { money } from "@/lib/currency";
import { useI18n } from "@/lib/i18n-react";
import { cn } from "@/lib/util";
import { ErrorNote, PrimaryButton, Sheet } from "./ui";

/** HH:mm shifted by `minutes`, kept within the same day. */
export function shiftTime(hhmm: string, minutes: number): string {
  const m = Math.max(0, Math.min(23 * 60 + 59, minutesOf(hhmm) + minutes));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Current time as HH:mm, rounded up to the next 15 minutes: the default for a stop added on the road. */
function nextQuarterHour(): string {
  const d = new Date();
  const m = Math.min(23 * 60 + 45, Math.ceil((d.getHours() * 60 + d.getMinutes()) / 15) * 15);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Owner edits a stop by hand (no AI): quick on-the-road actions (visited, skip, push later, move to tomorrow)
 * and the full form. With no `item` it adds a new stop to `day`. Every change goes through applyOps, so it
 * lands in the chat's change log like AI edits do.
 */
export function StopEditor({ trip, day, item, onClose }: { trip: Trip; day: number; item?: ItineraryItem; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { applyItinerary } = useApp();
  const isNew = !item;
  const [title, setTitle] = useState(item?.title ?? "");
  const [time, setTime] = useState(item?.time ?? (isToday(trip, day) ? nextQuarterHour() : "09:00"));
  const [toDay, setToDay] = useState(day);
  const [category, setCategory] = useState<ItemCategory>(item?.category ?? "sight");
  const [cost, setCost] = useState(item?.estCost ? String(item.estCost) : "");
  const [address, setAddress] = useState(item?.address ?? "");
  const [note, setNote] = useState(item?.note ?? "");
  const [tips, setTips] = useState((item?.tips ?? []).join("\n"));
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const lastDay = Math.max(...trip.itinerary.map((d) => d.day), day);

  const run = async (key: string, ops: ItineraryOp[]) => {
    setBusy(key); setError(undefined);
    try { await applyItinerary(trip, ops); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : t("common.somethingWrong")); }
    finally { setBusy(undefined); }
  };

  const quick = (key: string, patch: ItineraryItemPatch) => item && run(key, [{ action: "edit", day, itemId: item.id, item: patch }]);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const name = title.trim();
    if (!name) return setError(t("stop.needTitle"));
    const hhmm = normalizeTime(time);
    if (!hhmm) return setError(t("stop.badTime"));
    const estCost = cost.trim() ? parseAmount(cost) : 0;
    if (estCost === undefined || estCost < 0) return setError(t("expense.invalidAmount"));
    const fields: ItineraryItemPatch = {
      title: name, time: hhmm, category, estCost, address: address.trim() || undefined, note: note.trim(),
      tips: tips.split("\n").map((s) => s.trim()).filter(Boolean),
    };
    if (isNew) return run("save", [{ action: "add", day: toDay, item: fields }]);
    const ops: ItineraryOp[] = [{ action: "edit", day, itemId: item.id, item: fields }];
    if (toDay !== day) ops.push({ action: "move", day, itemId: item.id, toDay, item: { time: hhmm } });
    run("save", ops);
  };

  const field = "w-full rounded-2xl bg-surface px-4 py-3 text-[15px] outline-none focus:ring-2 focus:ring-primary/30";
  const label = "mb-1.5 block text-[11px] font-bold tracking-widest text-ink-2 uppercase";

  return (
    <Sheet title={isNew ? t("stop.addTitle") : item.title} subtitle={t("expense.dayN", { n: day })} onClose={onClose} locked={!!busy}
      footer={
        <PrimaryButton color="primary" type="submit" form="stop-form" disabled={!!busy}>
          {busy === "save" && <Loader2 className="h-5 w-5 animate-spin" />} {t(isNew ? "stop.add" : "stop.save")}
        </PrimaryButton>
      }>
      {!isNew && (
        <div className="grid grid-cols-2 gap-2">
          {item.status ? (
            <QuickButton busy={busy === "status"} onClick={() => quick("status", { status: null })} icon={<RotateCcw className="h-4 w-4" />} className="col-span-2">
              {t("stop.reopen")}
            </QuickButton>
          ) : (
            <>
              <QuickButton busy={busy === "done"} onClick={() => quick("done", { status: "done" })} icon={<Check className="h-4 w-4" />} className="bg-emerald-50 text-emerald-800">
                {t("stop.markDone")}
              </QuickButton>
              <QuickButton busy={busy === "skip"} onClick={() => quick("skip", { status: "skipped" })} icon={<CircleSlash className="h-4 w-4" />}>
                {t("stop.skip")}
              </QuickButton>
            </>
          )}
          <QuickButton busy={busy === "+30"} onClick={() => quick("+30", { time: shiftTime(item.time, 30) })} icon={<Clock className="h-4 w-4" />}>
            {t("stop.later", { n: 30 })}
          </QuickButton>
          <QuickButton busy={busy === "+60"} onClick={() => quick("+60", { time: shiftTime(item.time, 60) })} icon={<Clock className="h-4 w-4" />}>
            {t("stop.later", { n: 60 })}
          </QuickButton>
          <QuickButton busy={busy === "next"} className="col-span-2"
            onClick={() => run("next", [{ action: "move", day, itemId: item.id, toDay: day + 1 }])} icon={<CalendarArrowUp className="h-4 w-4" />}>
            {t(day + 1 > lastDay ? "stop.toNewDay" : "stop.toNextDay", { n: day + 1 })}
          </QuickButton>
        </div>
      )}

      <form id="stop-form" onSubmit={save} className="space-y-4">
        <div>
          <label htmlFor="stop-title" className={label}>{t("stop.name")}</label>
          <input id="stop-title" value={title} maxLength={120} autoFocus={isNew} onChange={(e) => setTitle(e.target.value)} placeholder={t("stop.namePlaceholder")} className={field} />
        </div>

        <div className="flex gap-2">
          <div className="w-[130px] shrink-0">
            <label htmlFor="stop-time" className={label}>{t("stop.time")}</label>
            <input id="stop-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className={field} />
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor="stop-day" className={label}>{t("expense.day")}</label>
            <select id="stop-day" value={toDay} onChange={(e) => setToDay(Number(e.target.value))} className={field}>
              {Array.from({ length: lastDay + 1 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{t("expense.dayN", { n: d })}{d > lastDay ? ` (${t("stop.newDay")})` : ""}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <div className={label}>{t("expense.category")}</div>
          <div className="flex flex-wrap gap-1.5">
            {ITEM_CATEGORIES.map((c) => (
              <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)}
                className={cn("rounded-full px-3 py-1.5 text-sm font-medium transition", category === c ? "bg-primary text-white" : "bg-surface text-ink-2")}>
                {t(`expense.cat.${c}`)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="stop-cost" className={label}>{t("stop.cost", { currency: trip.currency })}</label>
          <input id="stop-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" className={field} />
          {parseAmount(cost) ? <div className="mt-1 text-xs text-muted">{money(parseAmount(cost)!, trip.currency, lang)} · {t("stop.perPerson")}</div> : null}
        </div>

        <div>
          <label htmlFor="stop-address" className={label}>{t("stop.address")}</label>
          <input id="stop-address" value={address} maxLength={200} onChange={(e) => setAddress(e.target.value)} placeholder={t("stop.addressPlaceholder")} className={field} />
        </div>

        <div>
          <label htmlFor="stop-note" className={label}>{t("stop.note")}</label>
          <textarea id="stop-note" value={note} rows={2} maxLength={1000} onChange={(e) => setNote(e.target.value)} className={cn(field, "resize-none")} />
        </div>

        <div>
          <label htmlFor="stop-tips" className={label}>{t("itin.prepTips")}</label>
          <textarea id="stop-tips" value={tips} rows={3} maxLength={1500} onChange={(e) => setTips(e.target.value)} placeholder={t("stop.tipsPlaceholder")} className={cn(field, "resize-none")} />
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}

        {!isNew && (
          <button type="button" disabled={!!busy}
            onClick={() => { if (confirm(t("stop.deleteConfirm", { title: item.title }))) run("delete", [{ action: "remove", day, itemId: item.id }]); }}
            className="flex w-full items-center justify-center gap-2 py-2 text-sm font-semibold text-red-600 disabled:opacity-60">
            {busy === "delete" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} {t("stop.delete")}
          </button>
        )}
      </form>
    </Sheet>
  );
}

function QuickButton({ busy, onClick, icon, className, children }: {
  busy: boolean; onClick: () => void; icon: React.ReactNode; className?: string; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} disabled={busy}
      className={cn("flex items-center justify-center gap-1.5 rounded-2xl bg-surface px-3 py-3 text-sm font-semibold text-ink-2 transition active:scale-[0.98] disabled:opacity-60", className)}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon} {children}
    </button>
  );
}

/** The trip day falls on today's date (local time). */
export function isToday(trip: Trip, day: number): boolean {
  const date = trip.itinerary.find((d) => d.day === day)?.date;
  if (!date) return false;
  const now = new Date();
  return date === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
