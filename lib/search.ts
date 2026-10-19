import type { FlightOffer, FlightQuery, HotelOffer, HotelQuery, PlaceQuery, PlaceResult } from "./types";
import { airportCode, findCity } from "./mock-data";
import { capitalizeWords, seededRandom } from "./util";

/**
 * MOCK travel search (MVP). Deterministic, offline.
 * Swap these bodies for real APIs later (Amadeus/Duffel, Booking, Google Places) — the tool contract stays the same.
 */
const pad = (n: number) => String(n).padStart(2, "0");

export async function searchFlights(q: FlightQuery): Promise<FlightOffer[]> {
  const origin = (q.origin || "SGN").toUpperCase();
  const dest = airportCode(q.destination);
  const rnd = seededRandom(`${origin}-${dest}-${q.date}`);
  const airlines: [string, string][] = [["Vietnam Airlines", "VN"], ["ANA", "NH"], ["Singapore Airlines", "SQ"], ["VietJet Air", "VJ"], ["Japan Airlines", "JL"], ["Cathay Pacific", "CX"]];
  return [0, 1, 2].map((i) => {
    const [airline, code] = airlines[rnd(airlines.length)];
    const depH = 6 + rnd(14);
    const stops = i === 0 ? 0 : rnd(2);
    const duration = 180 + rnd(420) + stops * 75;
    const arr = depH * 60 + duration;
    return {
      airline, flightNumber: `${code}${100 + rnd(800)}`, origin, destination: dest,
      departure: `${q.date} ${pad(depH)}:${pad(rnd(4) * 15)}`,
      arrival: `${pad(Math.floor(arr / 60) % 24)}:${pad(arr % 60)}${arr >= 1440 ? " +1" : ""}`,
      stops, durationMinutes: duration,
      price: (180 + rnd(520)) * Math.max(1, q.travelers || 1),
      currency: "USD",
    };
  }).sort((a, b) => a.price - b.price);
}

export async function searchHotels(q: HotelQuery): Promise<HotelOffer[]> {
  const city = findCity(q.location);
  const rnd = seededRandom(`${q.location}-${q.checkIn}`);
  const b = (q.budget ?? "").toLowerCase();
  const base = b.includes("lux") ? 320 : b.includes("budget") || b.includes("cheap") ? 55 : 140;
  const names = city?.hotelNames ?? [`${q.location.split(",")[0]} Central Hotel`, "Garden Inn", "Riverside Suites"];
  const [lat, lng] = city?.center ?? [0, 0];
  return names.map((name, i) => ({
    name,
    area: city?.areas[i % city.areas.length] ?? "City center",
    rating: 4.1 + rnd(9) / 10,
    pricePerNight: Math.round(base * (0.8 + rnd(50) / 100)),
    currency: "USD",
    lat: lat ? lat + (rnd(40) - 20) / 1000 : 0,
    lng: lng ? lng + (rnd(40) - 20) / 1000 : 0,
  }));
}

export async function searchPlaces(q: PlaceQuery): Promise<PlaceResult[]> {
  const city = findCity(q.near);
  const pool = city?.places ?? [];
  const query = q.query.toLowerCase().trim();
  const type = q.type?.toLowerCase();

  const byName = pool.filter((p) => p.name.toLowerCase().includes(query) || query.includes(p.name.toLowerCase()));
  if (byName.length) return byName;

  const keywords = query.split(/\s+/).filter((k) => k.length > 3);
  const byType = pool.filter((p) =>
    (type && (p.type.includes(type) || (type === "restaurant" && p.type === "food"))) ||
    keywords.some((k) => p.type.includes(k) || (p.note ?? "").toLowerCase().includes(k)));
  if (byType.length) return byType.slice(0, 4);

  if (city) {
    const rnd = seededRandom(query);
    return [{
      placeId: `mock-${rnd(100000)}`, name: capitalizeWords(q.query), type: type ?? "sight",
      lat: city.center[0] + (rnd(60) - 30) / 1000, lng: city.center[1] + (rnd(60) - 30) / 1000, estCost: 10,
    }];
  }
  return [];
}

/** Free geocoding (no key) for destinations outside the sample cities. */
export async function geocode(text: string): Promise<[number, number] | undefined> {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=${encodeURIComponent(text.split(",")[0])}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const json = (await res.json()) as { results?: { latitude: number; longitude: number }[] };
    const r = json.results?.[0];
    return r ? [r.latitude, r.longitude] : undefined;
  } catch {
    return undefined;
  }
}
