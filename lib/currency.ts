import { LOCALE, type Lang } from "./i18n";
import type { Trip } from "./types";

export const CURRENCIES = ["USD", "VND", "EUR", "JPY", "KRW", "THB", "SGD", "AUD", "GBP"] as const;

/** Default currency for a UI language (used until the profile picks one). */
export const DEFAULT_CURRENCY: Record<Lang, string> = { en: "USD", vi: "VND" };

/** Rough units per 1 USD, used only when the live rate service is unreachable. */
export const FALLBACK_USD_RATES: Record<string, number> = {
  USD: 1, VND: 26_000, EUR: 0.92, JPY: 150, KRW: 1_380, THB: 35, SGD: 1.34, AUD: 1.52, GBP: 0.78,
};

/** Rounds to what a traveler would actually budget: 1,000₫ steps, 10¥ steps, whole units elsewhere. */
export function roundAmount(n: number, currency: string): number {
  const step = currency === "VND" ? 1_000 : currency === "JPY" || currency === "KRW" ? 10 : 1;
  return Math.round(n / step) * step;
}

export const money = (n: number, currency = "USD", lang: Lang = "en") =>
  new Intl.NumberFormat(LOCALE[lang], { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

/** Re-prices every stop: `rate` is how many `to` one unit of the trip's current currency buys. */
export function convertTripCosts(trip: Trip, to: string, rate: number): Trip {
  return {
    ...trip,
    currency: to,
    itinerary: trip.itinerary.map((d) => ({ ...d, items: d.items.map((i) => ({ ...i, estCost: roundAmount((i.estCost || 0) * rate, to) })) })),
  };
}
