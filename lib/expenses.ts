import { FALLBACK_USD_RATES } from "./currency";
import { ITEM_CATEGORIES, type ExpensePerson, type ExpenseSplit, type ItemCategory, type ItineraryItem, type Trip, type TripExpense } from "./types";

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
  /** Payer key → what they paid, with the latest display name. */
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
    const payer = payerOf(e);
    const p = (s.byPerson[payer.key] ??= { name: payer.name, total: 0 });
    p.total += v;
    if (payer.name) p.name = payer.name;
  }
  return s;
}

/** Estimated cost of the whole itinerary, per person (what the itinerary's estCost means). */
export const estimatedTotal = (trip: Pick<Trip, "itinerary">) => trip.itinerary.reduce((s, d) => s + d.items.reduce((n, i) => n + (i.estCost || 0), 0), 0);

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

// ───────────── Splitting ─────────────

/** Older rows have no payer: the author paid. */
export const payerOf = (e: TripExpense): ExpensePerson => e.paidBy ?? { key: e.authorId, name: e.authorName };

export const guestKey = (name: string) => `guest:${name.trim().toLowerCase()}`;
export const isGuest = (key: string) => key.startsWith("guest:");

/** Currencies people don't pay in fractions of. */
const ZERO_DECIMAL = new Set(["VND", "JPY", "KRW", "IDR", "CLP", "ISK", "HUF", "TWD", "UGX"]);
export const currencyDecimals = (currency: string) => (ZERO_DECIMAL.has(currency) ? 0 : 2);

/** Splits `amount` evenly; the leftover smallest units go to the first people so shares add up exactly. */
export function splitEqually(amount: number, people: ExpensePerson[], currency: string): ExpenseSplit["shares"] {
  if (!people.length) return [];
  const unit = 10 ** currencyDecimals(currency);
  const total = Math.round(amount * unit);
  const base = Math.floor(total / people.length);
  let rest = total - base * people.length;
  return people.map((p) => ({ ...p, amount: (base + (rest-- > 0 ? 1 : 0)) / unit }));
}

/** Exact shares must add up to the amount (to the currency's smallest unit). Returns the difference (amount − sum). */
export function splitRemainder(amount: number, shares: { amount: number }[], currency: string): number {
  const unit = 10 ** currencyDecimals(currency);
  return (Math.round(amount * unit) - shares.reduce((s, x) => s + Math.round(x.amount * unit), 0)) / unit;
}

export interface Balance { key: string; name: string; paid: number; owes: number; /** paid − owes: > 0 gets money back. */ net: number }

/** Per-person balances in the trip currency. Expenses without a split count as the payer's own. */
export function computeBalances(expenses: TripExpense[], currency: string, rates: UsdRates): Balance[] {
  const map = new Map<string, Balance>();
  const get = (p: ExpensePerson) => {
    let b = map.get(p.key);
    if (!b) map.set(p.key, (b = { key: p.key, name: p.name, paid: 0, owes: 0, net: 0 }));
    if (p.name) b.name = p.name;
    return b;
  };
  for (const e of expenses) {
    const rate = convertAmount(1, e.currency, currency, rates);
    if (rate === undefined) continue;
    const payer = get(payerOf(e));
    payer.paid += e.amount * rate;
    const shares = e.split?.shares.length ? e.split.shares : [{ ...payerOf(e), amount: e.amount }];
    for (const s of shares) get(s).owes += s.amount * rate;
  }
  return [...map.values()].map((b) => ({ ...b, net: b.paid - b.owes })).sort((a, b) => b.net - a.net);
}

export interface Transfer { from: ExpensePerson; to: ExpensePerson; amount: number }

/** Few transfers that settle everyone: the biggest debtor pays the biggest creditor, repeatedly. */
export function settleUp(balances: Balance[], currency: string): Transfer[] {
  const unit = 10 ** currencyDecimals(currency);
  const eps = 0.5 / unit;
  const creditors = balances.filter((b) => b.net > eps).map((b) => ({ ...b, left: b.net }));
  const debtors = balances.filter((b) => b.net < -eps).map((b) => ({ ...b, left: -b.net }));
  const out: Transfer[] = [];
  while (creditors.length && debtors.length) {
    creditors.sort((a, b) => b.left - a.left);
    debtors.sort((a, b) => b.left - a.left);
    const c = creditors[0], d = debtors[0];
    const amount = Math.min(c.left, d.left);
    out.push({ from: { key: d.key, name: d.name }, to: { key: c.key, name: c.name }, amount: Math.round(amount * unit) / unit });
    c.left -= amount; d.left -= amount;
    if (c.left <= eps) creditors.shift();
    if (d.left <= eps) debtors.shift();
  }
  return out.filter((t) => t.amount > 0);
}

// ───────────── Offline categories ─────────────

// Checked in order: "vé tàu" is transport before "vé" is a sight, "bia" is nightlife before food.
const CATEGORY_RULES: [ItemCategory, RegExp][] = [
  ["hotel", /hotel|khách sạn|homestay|hostel|airbnb|resort|motel|nhà nghỉ|ryokan|lodging|check-?in|phòng ở/],
  ["transport", /taxi|grab|uber|be bike|xanh sm|xe ôm|bus|xe buýt|xe khách|limousine|tàu|train|shinkansen|metro|subway|mrt|flight|máy bay|vé bay|airport|sân bay|xăng|fuel|gas station|parking|gửi xe|đỗ xe|thuê xe|rental car|ferry|phà|toll|cầu đường|jr pass|suica|pasmo|oyster|cáp treo|cable car/],
  ["nightlife", /\bbar\b|pub|club|beer|bia|cocktail|rượu|wine|karaoke|izakaya|rooftop/],
  ["sight", /vé vào|vé tham quan|entrance|admission|ticket|museum|bảo tàng|chùa|đền|temple|shrine|pagoda|castle|lâu đài|palace|cung điện|gallery|zoo|sở thú|aquarium|công viên|park|landmark|tham quan|observatory|tower/],
  ["activity", /tour|lặn|snorkel|diving|kayak|spa|massage|onsen|tắm|lớp học|class|workshop|show|concert|hòa nhạc|trekking|hike|leo núi|surf|zipline|cooking|chèo|vui chơi|theme park|disney|universal/],
  ["shopping", /mua|shopping|souvenir|quà|gift|chợ|market|siêu thị|supermarket|mall|trung tâm thương mại|outlet|cửa hàng|store|shop|don quijote|uniqlo|thuốc|pharmacy|sim|esim/],
  ["food", /ăn|cơm|phở|bún|bánh|mì|lẩu|nướng|hải sản|seafood|cafe|café|cà phê|coffee|trà|tea|sinh tố|kem|ice cream|breakfast|lunch|dinner|bữa|nhà hàng|restaurant|quán|food|ramen|sushi|udon|bbq|buffet|snack|đồ uống|drink|nước|water|pizza|burger/],
];

/** Keyword guess for when Gemini isn't available; keeps the current category when nothing matches. */
export function guessCategory(text: string, current: ItemCategory): ItemCategory {
  const t = text.toLowerCase();
  for (const [cat, re] of CATEGORY_RULES) if (re.test(t)) return cat;
  return current;
}

export const isItemCategory = (v: unknown): v is ItemCategory => typeof v === "string" && (ITEM_CATEGORIES as string[]).includes(v);

/**
 * Moves everything `from` paid or owes in one expense to `to` (a virtual traveler linked to a real member).
 * Shares merge if `to` already had one. Returns undefined when the expense doesn't involve `from`.
 */
export function rekeyExpense(e: { paidBy?: ExpensePerson; split?: ExpenseSplit }, from: string, to: ExpensePerson) {
  const paidBy = e.paidBy?.key === from ? to : e.paidBy;
  let split = e.split;
  if (split?.shares.some((s) => s.key === from)) {
    const shares: ExpenseSplit["shares"] = [];
    for (const s of split.shares) {
      const next = s.key === from ? { ...to, amount: s.amount } : s;
      const same = shares.find((x) => x.key === next.key);
      if (same) same.amount = Math.round((same.amount + next.amount) * 100) / 100;
      else shares.push({ ...next });
    }
    split = { ...split, shares };
  }
  return paidBy === e.paidBy && split === e.split ? undefined : { paidBy, split };
}
