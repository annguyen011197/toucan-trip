import { FALLBACK_USD_RATES } from "./currency";
import type { ItemCategory, ItineraryItem, Trip, TripExpense } from "./types";

/** Units per 1 USD. */
export type UsdRates = Record<string, number>;

/** `amount` of `from` in `to`; undefined when either rate is unknown. */
export function convertAmount(amount: number, from: string, to: string, rates: UsdRates): number | undefined {
  if (from === to) return amount;
  const a = rates[from] ?? FALLBACK_USD_RATES[from];
  const b = rates[to] ?? FALLBACK_USD_RATES[to];
  return a && b ? (amount / a) * b : undefined;
}

export interface ExpenseSummary {
  /** Everything converted to `currency` (the trip's). */
  total: number;
  currency: string;
  /** Some expenses were paid in another currency, so `total` depends on exchange rates. */
  converted: boolean;
  /** Expenses whose currency had no rate; left out of the totals. */
  skipped: number;
  /** Key "0" = not tied to a day. */
  byDay: Record<number, number>;
  byCategory: Partial<Record<ItemCategory, number>>;
  byItem: Record<string, number>;
  /** authorId → total, with the latest display name. */
  byPerson: Record<string, { name: string; total: number }>;
}

export function summarizeExpenses(expenses: TripExpense[], currency: string, rates: UsdRates): ExpenseSummary {
  const s: ExpenseSummary = { total: 0, currency, converted: false, skipped: 0, byDay: {}, byCategory: {}, byItem: {}, byPerson: {} };
  for (const e of expenses) {
    const v = convertAmount(e.amount, e.currency, currency, rates);
    if (v === undefined) { s.skipped++; continue; }
    if (e.currency !== currency) s.converted = true;
    s.total += v;
    const d = e.day ?? 0;
    s.byDay[d] = (s.byDay[d] ?? 0) + v;
    s.byCategory[e.category] = (s.byCategory[e.category] ?? 0) + v;
    if (e.itemId) s.byItem[e.itemId] = (s.byItem[e.itemId] ?? 0) + v;
    const p = (s.byPerson[e.authorId] ??= { name: e.authorName, total: 0 });
    p.total += v;
    if (e.authorName) p.name = e.authorName;
  }
  return s;
}

/** Estimated cost of the whole itinerary, per person (what the itinerary's estCost means). */
export const estimatedTotal = (trip: Trip) => trip.itinerary.reduce((s, d) => s + d.items.reduce((n, i) => n + (i.estCost || 0), 0), 0);

/** Prefill for logging an expense at a stop. */
export function expenseDraftFor(item: ItineraryItem, day: number, currency: string): Pick<TripExpense, "title" | "amount" | "currency" | "category" | "day" | "itemId"> {
  return { title: item.title, amount: item.estCost || 0, currency, category: item.category, day, itemId: item.id };
}

/** Parses an amount typed with either decimal separator and optional grouping ("1.250.000", "12,5", "1,250.75"). */
export function parseAmount(input: string): number | undefined {
  let s = input.replace(/[^\d.,]/g, "");
  if (!s) return undefined;
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  const sep = Math.max(lastDot, lastComma);
  // A separator followed by exactly 3 digits, with no other kind of separator, is grouping ("1.000" = 1000).
  const decimals = sep >= 0 ? s.length - sep - 1 : 0;
  const onlyOneKind = lastDot < 0 || lastComma < 0;
  if (sep >= 0 && onlyOneKind && (decimals === 3 || s.indexOf(s[sep]) !== sep)) s = s.replace(/[.,]/g, "");
  else if (sep >= 0) s = s.slice(0, sep).replace(/[.,]/g, "") + "." + s.slice(sep + 1);
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
