import { FALLBACK_USD_RATES } from "../currency";

/** Free, keyless daily rates (https://www.exchangerate-api.com/docs/free). Includes VND, unlike ECB-based APIs. */
const RATES_URL = "https://open.er-api.com/v6/latest/USD";

/** Units of each currency per 1 USD. Cached by Next for 12h; falls back to rough built-in rates. */
export async function usdRates(): Promise<Record<string, number>> {
  try {
    const res = await fetch(RATES_URL, { next: { revalidate: 43_200 }, signal: AbortSignal.timeout(5_000) });
    const data = (await res.json()) as { result?: string; rates?: Record<string, number> };
    if (res.ok && data.result === "success" && data.rates) return data.rates;
  } catch (e) {
    console.warn("[rates]", e);
  }
  return FALLBACK_USD_RATES;
}

/** How many `to` one `from` buys. */
export async function exchangeRate(from: string, to: string): Promise<number> {
  if (from === to) return 1;
  const rates = await usdRates();
  const a = rates[from] ?? FALLBACK_USD_RATES[from];
  const b = rates[to] ?? FALLBACK_USD_RATES[to];
  if (!a || !b) throw new Error(`No exchange rate for ${from} → ${to}`);
  return b / a;
}
