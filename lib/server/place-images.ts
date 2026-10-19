import type { ItineraryItem, Trip } from "../types";
import { hasLocation } from "../itinerary-engine";

/**
 * Free photos for itinerary stops from Wikipedia / Wikimedia Commons (no key).
 * Finds articles near the stop's coordinates whose title matches the stop, takes the article's lead image
 * (free licenses only) and stores it with an attribution line. Great for landmarks; generic stops
 * ("Local Breakfast Café") simply don't match and keep the gradient fallback.
 */

const API = "https://en.wikipedia.org/w/api.php";
// Wikimedia rate limits: 200 req/min with a User-Agent that includes contact info (email or URL), but only
// 10 req/min without one; at most 3 concurrent requests. https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits
const CONTACT = process.env.WIKIMEDIA_CONTACT;
const HEADERS = { "User-Agent": `ToucanTrip/0.1${CONTACT ? ` (${CONTACT})` : ""} itinerary-place-photos` };
const CONCURRENCY = 3;
const TIMEOUT_MS = 3500;
const MAX_LOOKUPS = 15;
const NEARBY_RADIUS_M = 400;
const TEXT_SEARCH_MAX_KM = 3;

interface WikiPage {
  title: string;
  pageimage?: string;
  thumbnail?: { source: string };
  coordinates?: { lat: number; lon: number }[];
}

interface Match { url: string; file: string }

class RateLimited extends Error {}

/** Fills `imageUrl` / `imageCredit` on stops that haven't been looked up yet. Never throws. */
export async function addPlaceImages(trip: Trip): Promise<Trip> {
  const todo = trip.itinerary.flatMap((d) => d.items).filter((i) => !i.imageUrl && !i.imageSearched && hasLocation(i)).slice(0, MAX_LOOKUPS);
  if (!todo.length) return trip;

  const city = trip.destination?.split(",")[0];
  const found = new Map<string, Match | null>(); // null = searched, nothing suitable
  let limited = false;
  const queue = [...todo];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let item = queue.shift(); item && !limited; item = queue.shift()) {
      try {
        found.set(item.id, await findImage(item, city));
      } catch (e) {
        // Unmarked stops are retried on a later turn. After a 429, stop asking for this turn.
        if (e instanceof RateLimited) limited = true;
      }
    }
  }));

  const credits = await fetchCredits([...found.values()].flatMap((m) => (m ? [m.file] : []))).catch(() => new Map<string, ItineraryItem["imageCredit"]>());
  return {
    ...trip,
    itinerary: trip.itinerary.map((d) => ({
      ...d,
      items: d.items.map((i) => {
        if (!found.has(i.id)) return i;
        const m = found.get(i.id);
        if (!m) return { ...i, imageSearched: true };
        const credit = credits.get(m.file);
        // Commons licenses require attribution: without a credit line, skip the photo and retry later.
        return credit ? { ...i, imageUrl: m.url, imageCredit: credit, imageSearched: true } : i;
      }),
    })),
  };
}

async function findImage(item: ItineraryItem, city?: string): Promise<Match | null> {
  const nearby = await query({
    generator: "geosearch", ggscoord: `${item.lat}|${item.lng}`, ggsradius: String(NEARBY_RADIUS_M), ggslimit: "20",
  });
  const near = best(item, nearby, 0.6);
  if (near) return near;

  // Coordinates from the model can be a little off: try a text search, but only accept pages close by.
  const searched = await query({ generator: "search", gsrsearch: [item.title, city].filter(Boolean).join(" "), gsrlimit: "5" });
  return best(item, searched.filter((p) => {
    const c = p.coordinates?.[0];
    return c && distanceKm(item.lat, item.lng, c.lat, c.lon) <= TEXT_SEARCH_MAX_KM;
  }), 0.75);
}

async function query(params: Record<string, string>): Promise<WikiPage[]> {
  const qs = new URLSearchParams({
    action: "query", format: "json", formatversion: "2",
    prop: "pageimages|coordinates", piprop: "thumbnail|name", pithumbsize: "640", pilicense: "free",
    ...params,
  });
  const res = await fetch(`${API}?${qs}`, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 429) throw new RateLimited();
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
  const json = (await res.json()) as { query?: { pages?: WikiPage[] } };
  return json.query?.pages ?? [];
}

function best(item: ItineraryItem, pages: WikiPage[], threshold: number): Match | null {
  let top: { score: number; dist: number; page: WikiPage } | undefined;
  for (const page of pages) {
    if (!page.thumbnail?.source || !page.pageimage) continue;
    const score = titleScore(item.title, page.title);
    if (score < threshold) continue;
    const c = page.coordinates?.[0];
    const dist = c ? distanceKm(item.lat, item.lng, c.lat, c.lon) : Infinity;
    if (!top || score > top.score || (score === top.score && dist < top.dist)) top = { score, dist, page };
  }
  return top ? { url: top.page.thumbnail!.source, file: top.page.pageimage! } : null;
}

/** Author + license for Commons files, batched (≤ 50 titles per request). */
async function fetchCredits(files: string[]) {
  const out = new Map<string, ItineraryItem["imageCredit"]>();
  const unique = [...new Set(files)];
  for (let i = 0; i < unique.length; i += 50) {
    const qs = new URLSearchParams({
      action: "query", format: "json", formatversion: "2", prop: "imageinfo", iiprop: "extmetadata|url",
      titles: unique.slice(i, i + 50).map((f) => `File:${f}`).join("|"),
    });
    const res = await fetch(`${API}?${qs}`, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) break; // those stops stay unmarked and are retried on a later turn
    const json = (await res.json()) as {
      query?: {
        normalized?: { from: string; to: string }[];
        pages?: { title: string; imageinfo?: { descriptionurl?: string; extmetadata?: Record<string, { value?: string }> }[] }[];
      };
    };
    const original = new Map((json.query?.normalized ?? []).map((n) => [n.to, n.from]));
    for (const p of json.query?.pages ?? []) {
      const info = p.imageinfo?.[0];
      if (!info?.descriptionurl) continue;
      const artist = stripHtml(info.extmetadata?.Artist?.value);
      const license = stripHtml(info.extmetadata?.LicenseShortName?.value);
      const file = (original.get(p.title) ?? p.title).replace(/^File:/, "");
      out.set(file.replace(/ /g, "_"), {
        text: [artist ? `Photo: ${artist}` : "Photo", license, "Wikimedia Commons"].filter(Boolean).join(" · "),
        url: info.descriptionurl,
      });
    }
  }
  return out;
}

// ───────────── title matching ─────────────

const STOPWORDS = new Set([
  "the", "of", "a", "an", "and", "at", "in", "on", "to", "de", "da", "la", "le", "del", "di", "du",
  "lunch", "dinner", "breakfast", "brunch", "tour", "walk", "stroll", "visit", "evening", "morning", "afternoon",
  "night", "sunset", "sunrise", "local", "tasting", "ride", "trek", "hike", "experience", "cruise", "class", "explore",
]);

const tokens = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]s\b/g, "")
    .split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOPWORDS.has(t));

/** "Kinkaku-ji (Golden Pavilion)" → ["Kinkaku-ji", "Golden Pavilion"] */
const names = (title: string) => {
  const inner = title.match(/\(([^)]+)\)/)?.[1];
  return [title.replace(/\([^)]*\)/g, "").trim(), inner].filter((n): n is string => !!n);
};

const sameToken = (a: string, b: string) => a === b || (a.length >= 6 && b.length >= 6 && editDistance(a, b) <= 1);

/** Overlap in both directions, so "Kyoto Tower Dinner" doesn't match the "Kyoto" article. */
export function titleScore(stop: string, page: string): number {
  const b = tokens(page.replace(/\s*\([^)]*\)$/, "")); // drop disambiguation: "Gion (Kyoto)"
  if (!b.length) return 0;
  return Math.max(0, ...names(stop).map((n) => {
    const a = tokens(n);
    if (!a.length) return 0;
    const shared = a.filter((t) => b.some((u) => sameToken(t, u))).length;
    return Math.min(shared / a.length, shared / b.length);
  }));
}

function editDistance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const stripHtml = (s?: string) => s?.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() || undefined;

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}
