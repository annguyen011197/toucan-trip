"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ChevronRight, Loader2, Plus, Trash2, Wallet } from "lucide-react";
import { useApp, type ExpenseInput } from "@/lib/app-state";
import { ITEM_CATEGORIES, type ItemCategory, type ItineraryItem, type Trip, type TripExpense } from "@/lib/types";
import { CURRENCIES, FALLBACK_USD_RATES, money } from "@/lib/currency";
import { estimatedTotal, parseAmount, summarizeExpenses, type ExpenseSummary, type UsdRates } from "@/lib/expenses";
import { useI18n } from "@/lib/i18n-react";
import { LOCALE } from "@/lib/i18n";
import { cn } from "@/lib/util";
import { ErrorNote, PrimaryButton, Sheet } from "./ui";

/** Live expenses of a trip, newest first. */
export function useTripExpenses(tripId: string) {
  const { subscribeExpenses } = useApp();
  const [expenses, setExpenses] = useState<TripExpense[]>([]);
  useEffect(() => subscribeExpenses(tripId, setExpenses), [tripId, subscribeExpenses]);
  return expenses;
}

// One fetch per page load; built-in rough rates until it answers (or if it fails).
let ratesPromise: Promise<UsdRates> | undefined;
function useUsdRates() {
  const [rates, setRates] = useState<UsdRates>(FALLBACK_USD_RATES);
  useEffect(() => {
    ratesPromise ??= fetch("/api/rates").then((r) => r.json()).then((d: { rates?: UsdRates }) => d.rates ?? FALLBACK_USD_RATES)
      .catch(() => { ratesPromise = undefined; return FALLBACK_USD_RATES; });
    let live = true;
    ratesPromise.then((r) => live && setRates(r));
    return () => { live = false; };
  }, []);
  return rates;
}

export function useExpenseSummary(trip: Trip, expenses: TripExpense[]) {
  const rates = useUsdRates();
  return useMemo(() => summarizeExpenses(expenses, trip.currency, rates), [expenses, trip.currency, rates]);
}

/** Itinerary estimates are per person, expenses are what the group paid. */
const groupEstimate = (trip: Trip) => estimatedTotal(trip) * Math.max(1, trip.travelers ?? 1);

/** Spent vs. estimate, under the itinerary's cost card. */
export function ExpenseSummaryCard({ trip, summary, count, onOpen }: { trip: Trip; summary: ExpenseSummary; count: number; onOpen: () => void }) {
  const { t, lang } = useI18n();
  const est = groupEstimate(trip);
  const pct = est > 0 ? Math.round((summary.total / est) * 100) : undefined;
  const over = est > 0 && summary.total > est;
  return (
    <button onClick={onOpen} className="mx-5 block w-[calc(100%-40px)] rounded-card border border-line p-[18px] text-left">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><Wallet className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold tracking-widest text-ink-2">{t("expense.spent")}</div>
          <div className="text-xl font-bold">{summary.converted && "≈ "}{money(summary.total, trip.currency, lang)}</div>
        </div>
        <span className="flex items-center gap-0.5 text-sm font-semibold text-primary">
          {count ? t("expense.view", { n: count }) : t("expense.add")} <ChevronRight className="h-4 w-4" />
        </span>
      </div>
      {est > 0 && (
        <>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface">
            <div className={cn("h-full rounded-full", over ? "bg-red-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-ink-2">
            <span>{t((trip.travelers ?? 1) > 1 ? "expense.estFor" : "expense.est", { amount: money(est, trip.currency, lang), n: trip.travelers ?? 1 })}</span>
            <span className={cn("font-semibold", over ? "text-red-600" : "text-emerald-700")}>
              {t(over ? "expense.over" : "expense.left", { amount: money(Math.abs(est - summary.total), trip.currency, lang) })}
            </span>
          </div>
        </>
      )}
    </button>
  );
}

export type ExpenseDraft = Partial<ExpenseInput>;

/** All expenses with breakdowns, plus the add/edit form. Opens straight on the form when given a `draft`. */
export function ExpensesSheet({ trip, expenses, summary, draft, onClose }: {
  trip: Trip; expenses: TripExpense[]; summary: ExpenseSummary; draft?: ExpenseDraft; onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const { uid } = useApp();
  const [editing, setEditing] = useState<ExpenseDraft | undefined>(draft);
  const [busy, setBusy] = useState(false);

  if (editing) {
    return <ExpenseForm trip={trip} draft={editing} onBusy={setBusy} busy={busy}
      onDone={() => (draft ? onClose() : setEditing(undefined))} onClose={onClose} />;
  }

  const days = Object.keys(summary.byDay).map(Number).sort((a, b) => (a || Infinity) - (b || Infinity));
  const byDay = (d: number) => expenses.filter((e) => (e.day ?? 0) === d);
  const people = Object.entries(summary.byPerson).sort((a, b) => b[1].total - a[1].total);
  const categories = (Object.entries(summary.byCategory) as [ItemCategory, number][]).sort((a, b) => b[1] - a[1]);

  return (
    <Sheet title={t("expense.title")} subtitle={trip.title} onClose={onClose}
      footer={<PrimaryButton color="primary" onClick={() => setEditing({})}><Plus className="h-5 w-5" /> {t("expense.add")}</PrimaryButton>}>
      <div className="rounded-2xl bg-surface p-4">
        <div className="text-[11px] font-bold tracking-widest text-ink-2">{t("expense.spent")}</div>
        <div className="text-2xl font-bold">{summary.converted && "≈ "}{money(summary.total, trip.currency, lang)}</div>
        {summary.converted && <div className="mt-1 text-xs text-muted">{t("expense.converted", { currency: trip.currency })}</div>}
        {summary.skipped > 0 && <div className="mt-1 text-xs text-amber-700">{t("expense.skipped", { n: summary.skipped })}</div>}
        {categories.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {categories.map(([c, v]) => (
              <span key={c} className="rounded-full bg-white px-2.5 py-1 text-xs text-ink-2">
                {t(`expense.cat.${c}`)} · <b className="text-ink">{money(v, trip.currency, lang)}</b>
              </span>
            ))}
          </div>
        )}
        {people.length > 1 && (
          <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
            <div className="text-[11px] font-bold tracking-widest text-ink-2 uppercase">{t("expense.byPerson")}</div>
            {people.map(([id, p]) => (
              <div key={id} className="flex justify-between">
                <span>{id === uid ? t("share.you") : p.name || t("share.someone")}</span>
                <span className="font-semibold">{money(p.total, trip.currency, lang)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {expenses.length === 0 && <p className="py-4 text-center text-sm text-muted">{t("expense.empty")}</p>}

      {days.map((d) => (
        <section key={d} className="space-y-2">
          <div className="flex justify-between text-sm font-bold">
            <span>{d ? t("expense.dayN", { n: d }) : t("expense.noDay")}</span>
            <span className="text-ink-2">{money(summary.byDay[d], trip.currency, lang)}</span>
          </div>
          {byDay(d).map((e) => (
            <ExpenseRow key={e.id} trip={trip} expense={e} mine={e.authorId === uid}
              onEdit={() => setEditing({ ...e })} />
          ))}
        </section>
      ))}
    </Sheet>
  );
}

function ExpenseRow({ trip, expense: e, mine, onEdit }: { trip: Trip; expense: TripExpense; mine: boolean; onEdit: () => void }) {
  const { t, lang } = useI18n();
  const { isOwner, deleteExpense } = useApp();
  const [busy, setBusy] = useState(false);
  const canDelete = mine || isOwner(trip);
  const remove = async () => {
    if (!confirm(t("expense.deleteConfirm"))) return;
    setBusy(true);
    try { await deleteExpense(e); } catch (err) { alert(err instanceof Error ? err.message : t("common.somethingWrong")); setBusy(false); }
  };
  return (
    <div className={cn("flex items-center gap-2 rounded-2xl border border-line px-3.5 py-3", busy && "opacity-60")}>
      <button disabled={!mine} onClick={onEdit} className="min-w-0 flex-1 text-left disabled:cursor-default">
        <div className="truncate font-semibold">{e.title}</div>
        <div className="truncate text-xs text-muted">
          {t(`expense.cat.${e.category}`)} · {mine ? t("share.you") : e.authorName || t("share.someone")}
          {" · "}{new Date(e.spentAt).toLocaleString(LOCALE[lang], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          {e.note && ` · ${e.note}`}
        </div>
      </button>
      <div className="text-right">
        <div className="font-semibold">{money(e.amount, e.currency, lang)}</div>
        {e.currency !== trip.currency && <div className="text-[11px] text-muted">{e.currency}</div>}
      </div>
      {canDelete && (
        <button aria-label={t("expense.delete")} disabled={busy} onClick={remove}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-red-600">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

const LAST_CURRENCY_KEY = "toucan-trip:expense-currency:";

function ExpenseForm({ trip, draft, busy, onBusy, onDone, onClose }: {
  trip: Trip; draft: ExpenseDraft; busy: boolean; onBusy: (b: boolean) => void; onDone: () => void; onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const { saveExpense } = useApp();
  const isNew = !draft.id;
  const [amount, setAmount] = useState(draft.amount ? String(draft.amount) : "");
  // Abroad people keep paying in the local currency, so a new expense starts in the last one used on this trip.
  const [currency, setCurrency] = useState(() => {
    if (draft.currency && !isNew) return draft.currency;
    try { return localStorage.getItem(LAST_CURRENCY_KEY + trip.id) || draft.currency || trip.currency; } catch { return draft.currency || trip.currency; }
  });
  const [title, setTitle] = useState(draft.title ?? "");
  const [category, setCategory] = useState<ItemCategory>(draft.category ?? "food");
  const [day, setDay] = useState<number | undefined>(draft.day ?? (isNew ? todayDay(trip) : undefined));
  const [itemId, setItemId] = useState(draft.itemId);
  const [note, setNote] = useState(draft.note ?? "");
  const [error, setError] = useState<string>();
  const stops: ItineraryItem[] = trip.itinerary.find((d) => d.day === day)?.items ?? [];
  // The stop may have moved to another day since; keep showing it rather than silently unlinking.
  const linked = itemId ? trip.itinerary.flatMap((d) => d.items).find((i) => i.id === itemId) : undefined;
  const currencies = CURRENCIES.includes(currency as never) ? CURRENCIES : [currency, ...CURRENCIES];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = parseAmount(amount);
    if (value === undefined || value <= 0) return setError(t("expense.invalidAmount"));
    if (!title.trim()) return setError(t("expense.needTitle"));
    onBusy(true); setError(undefined);
    try {
      await saveExpense(trip, {
        id: draft.id, createdAt: draft.createdAt, spentAt: draft.spentAt ?? Date.now(),
        amount: value, currency, title: title.trim(), category, day, itemId: itemId || undefined, note: note.trim(),
      });
      try { localStorage.setItem(LAST_CURRENCY_KEY + trip.id, currency); } catch { /* ignore */ }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.somethingWrong"));
    } finally {
      onBusy(false);
    }
  };

  const field = "w-full rounded-2xl bg-surface px-4 py-3 text-[15px] outline-none focus:ring-2 focus:ring-primary/30";
  const label = "mb-1.5 block text-[11px] font-bold tracking-widest text-ink-2 uppercase";

  return (
    <Sheet title={t(isNew ? "expense.add" : "expense.edit")} subtitle={trip.title} onClose={onClose} locked={busy}
      footer={
        <PrimaryButton color="primary" type="submit" form="expense-form" disabled={busy}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : null} {t("expense.save")}
        </PrimaryButton>
      }>
      <form id="expense-form" onSubmit={submit} className="space-y-4">
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="exp-amount" className={label}>{t("expense.amount")}</label>
            <input id="exp-amount" inputMode="decimal" autoComplete="off" autoFocus={isNew && !draft.amount} value={amount}
              onChange={(e) => setAmount(e.target.value)} placeholder="0" className={cn(field, "text-xl font-bold")} />
            {parseAmount(amount) ? <div className="mt-1 text-xs text-muted">{money(parseAmount(amount)!, currency, lang)}</div> : null}
          </div>
          <div className="w-[104px] shrink-0">
            <label htmlFor="exp-currency" className={label}>{t("expense.currency")}</label>
            <select id="exp-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={cn(field, "py-[15px] font-semibold")}>
              {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="exp-title" className={label}>{t("expense.what")}</label>
          <input id="exp-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={t("expense.whatPlaceholder")} className={field} />
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

        <div className="flex gap-2">
          <div className="w-[130px] shrink-0">
            <label htmlFor="exp-day" className={label}>{t("expense.day")}</label>
            <select id="exp-day" value={day ?? ""} className={field}
              onChange={(e) => { const d = e.target.value ? Number(e.target.value) : undefined; setDay(d); if (linked && !trip.itinerary.find((x) => x.day === d)?.items.some((i) => i.id === linked.id)) setItemId(undefined); }}>
              <option value="">{t("expense.noDay")}</option>
              {trip.itinerary.map((d) => <option key={d.day} value={d.day}>{t("expense.dayN", { n: d.day })}</option>)}
            </select>
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor="exp-stop" className={label}>{t("expense.stop")}</label>
            <select id="exp-stop" value={itemId ?? ""} disabled={!stops.length && !linked} className={cn(field, "disabled:opacity-60")}
              onChange={(e) => { setItemId(e.target.value || undefined); const s = stops.find((i) => i.id === e.target.value); if (s && !title.trim()) setTitle(s.title); }}>
              <option value="">{t("expense.noStop")}</option>
              {linked && !stops.some((s) => s.id === linked.id) && <option value={linked.id}>{linked.title}</option>}
              {stops.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="exp-note" className={label}>{t("expense.note")}</label>
          <textarea id="exp-note" value={note} maxLength={1000} rows={2} onChange={(e) => setNote(e.target.value)} className={cn(field, "resize-none")} />
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Sheet>
  );
}

/** The trip day matching today's date, so expenses logged on the road land on the right day. */
function todayDay(trip: Trip): number | undefined {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return trip.itinerary.find((x) => x.date === today)?.day;
}

/** Small "spent" pill + log button on a stop row. */
export function StopExpenseButton({ spent, currency, title, onClick }: { spent?: number; currency: string; title: string; onClick: () => void }) {
  const { t, lang } = useI18n();
  return (
    <button aria-label={t("expense.logAt", { title })} onPointerDown={(e) => e.stopPropagation()} onClick={onClick}
      className={cn("flex h-6 min-w-6 items-center justify-center gap-1 rounded-full px-1 text-[11px] font-bold",
        spent ? "bg-emerald-50 text-emerald-700" : "text-muted hover:bg-surface hover:text-ink")}>
      <Wallet className="h-3.5 w-3.5" />{spent ? money(spent, currency, lang) : null}
    </button>
  );
}

