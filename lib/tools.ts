import type { Card, FlightOffer, FlightQuery, HotelOffer, HotelQuery, ItineraryOp, PlaceQuery, PlaceResult, Place, Trip, TripInfoPatch } from "./types";
import { applyOps, EngineResult } from "./itinerary-engine";
import { findCity } from "./mock-data";
import { addDays, parseISODate } from "./time";
import * as search from "./search";
import { roundAmount } from "./currency";
import { uid } from "./util";
import { translator, type Lang } from "./i18n";
import type { Researcher } from "./engines/research";

/** Applies an updateTripInfo patch (pure). */
export function applyTripInfo(trip: Trip, patch: TripInfoPatch): Trip {
  const t: Trip = { ...trip, itinerary: trip.itinerary };
  if (patch.destination?.trim()) {
    t.destination = findCity(patch.destination)?.name ?? patch.destination.trim();
    const city = t.destination.split(",")[0];
    if (!t.title || t.title === translator("en")("common.newTrip") || t.title === translator("vi")("common.newTrip")) {
      t.title = t.language === "vi" ? `Khám phá ${city}` : `${city} Adventure`;
    }
  }
  if (patch.title?.trim()) t.title = patch.title.trim();
  if (patch.origin?.trim()) t.origin = patch.origin.trim();
  if (patch.startDate && parseISODate(patch.startDate)) t.startDate = patch.startDate.slice(0, 10);
  if (patch.endDate && parseISODate(patch.endDate)) t.endDate = patch.endDate.slice(0, 10);
  if (patch.travelers && patch.travelers > 0) t.travelers = patch.travelers;
  if (patch.budget?.trim()) t.budget = patch.budget.trim();
  if (patch.interests?.length) t.interests = patch.interests;
  if (patch.status) t.status = patch.status;
  if (t.startDate) t.itinerary = t.itinerary.map((d) => ({ ...d, date: addDays(t.startDate!, d.day - 1) }));
  t.updatedAt = Date.now();
  return t;
}

export function applyItinerary(trip: Trip, ops: ItineraryOp[], lang?: Lang): { trip: Trip; result: EngineResult } {
  const result = applyOps(ops, trip.itinerary, trip.startDate, lang ?? trip.language);
  return { trip: { ...trip, itinerary: result.itinerary, updatedAt: Date.now() }, result };
}

// ───────────── Card builders: prices only ever come from tool results ─────────────

export const flightCard = (f: FlightOffer): Card => ({
  id: uid(), kind: "flight", title: `${f.origin} → ${f.destination}`,
  subtitle: `${f.airline} · ${f.flightNumber} · ${f.stops === 0 ? "Nonstop" : `${f.stops} stop`}`,
  detail: `${f.departure} → ${f.arrival} · ${Math.floor(f.durationMinutes / 60)}h ${f.durationMinutes % 60}m`,
  price: f.price, currency: f.currency, isSample: true,
});

export const hotelCard = (h: HotelOffer, real = false): Card => ({
  id: uid(), kind: "hotel", title: h.name, subtitle: h.area, detail: h.note ?? "per night", price: h.pricePerNight, currency: h.currency,
  imageUrl: h.imageUrl, rating: h.rating || undefined, lat: h.lat, lng: h.lng, actionText: `Stay at ${h.name}`,
  url: h.url, isSample: !real, isEstimate: real,
});

export const placeCard = (p: PlaceResult, real = false): Card => ({
  id: uid(), kind: "place", title: p.name, subtitle: p.type.charAt(0).toUpperCase() + p.type.slice(1), detail: p.note,
  price: p.estCost, currency: p.currency ?? "USD", imageUrl: p.imageUrl, rating: p.rating, lat: p.lat, lng: p.lng,
  actionText: `Add ${p.name}`, url: p.url, isSample: !real, isEstimate: real,
});

/**
 * Executes chat tools for ONE bot turn against an in-memory copy of the trip.
 * The API route returns the final trip; the client persists it (single source of truth).
 */
export class ToolExecutor {
  trip: Trip;
  cards: Card[] = [];
  itineraryChanges: string[] = [];
  /** Real search for places/hotels; without it (offline, or when it fails) the mock data in search.ts answers. */
  research?: Researcher;

  /**
   * @param lang language of the change log (the user's chat language).
   * @param costScale multiplies new/edited `estCost`s — for engines that price in USD while the trip uses another currency.
   */
  constructor(trip: Trip, private lang?: Lang, private costScale = 1) {
    this.trip = structuredClone(trip);
  }

  updateTripInfo(patch: TripInfoPatch): Trip {
    this.trip = applyTripInfo(this.trip, patch);
    return this.trip;
  }

  updateItinerary(ops: ItineraryOp[]): EngineResult {
    if (this.costScale !== 1) {
      ops = ops.map((op) => (op.item?.estCost ? { ...op, item: { ...op.item, estCost: roundAmount(op.item.estCost * this.costScale, this.trip.currency) } } : op));
    }
    const { trip, result } = applyItinerary(this.trip, ops, this.lang);
    this.trip = trip;
    this.itineraryChanges.push(...result.changes);
    return result;
  }

  setHotel(hotel: Place) {
    this.trip = { ...this.trip, hotel, updatedAt: Date.now() };
  }

  async searchFlights(q: FlightQuery) {
    const r = await search.searchFlights(q);
    this.cards.push(...r.slice(0, 3).map(flightCard));
    return r;
  }

  async searchHotels(q: HotelQuery, asCards = true) {
    const real = await this.tryResearch(() => this.research!.hotels(q));
    const r = real ?? await search.searchHotels(q);
    if (asCards) this.cards.push(...r.slice(0, 3).map((h) => hotelCard(h, !!real)));
    return r;
  }

  async searchPlaces(q: PlaceQuery, asCards = true) {
    const real = await this.tryResearch(() => this.research!.places(q));
    const r = real ?? await search.searchPlaces(q);
    if (asCards) this.cards.push(...r.slice(0, 4).map((p) => placeCard(p, !!real)));
    return r;
  }

  private async tryResearch<T>(run: () => Promise<T[]>): Promise<T[] | undefined> {
    if (!this.research) return undefined;
    try {
      const r = await run();
      return r.length ? r : undefined;
    } catch (e) {
      console.warn("[research]", e);
      return undefined;
    }
  }

  /** JSON bridge for Gemini function calls. */
  async execute(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    switch (name) {
      case "updateTripInfo":
        return { trip: snapshot(this.updateTripInfo(args as TripInfoPatch)) };
      case "updateItinerary": {
        const r = this.updateItinerary(((args.ops ?? []) as ItineraryOp[]));
        return { changes: r.changes, failures: r.failures, itinerary: snapshot(this.trip).itinerary };
      }
      case "searchFlights":
        return { results: await this.searchFlights(args as unknown as FlightQuery) };
      case "searchHotels":
        return { results: await this.searchHotels(args as unknown as HotelQuery) };
      case "searchPlaces":
        return { results: await this.searchPlaces(args as unknown as PlaceQuery) };
      default:
        return { error: `Unknown tool ${name}` };
    }
  }
}

/** Compact trip state for the model. */
export function snapshot(t: Trip) {
  return {
    title: t.title, destination: t.destination, origin: t.origin, startDate: t.startDate, endDate: t.endDate,
    language: t.language ?? "en", currency: t.currency,
    travelers: t.travelers, budget: t.budget, interests: t.interests, status: t.status, hotel: t.hotel?.name,
    itinerary: t.itinerary.map((d) => ({
      day: d.day, date: d.date,
      items: d.items.map((i) => ({ id: i.id, time: i.time, title: i.title, category: i.category, estCost: i.estCost, hasTips: !!i.tips?.length })),
    })),
  };
}
