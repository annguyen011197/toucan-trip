import type { ChatRequest, Trip, UserProfile } from "../types";
import { ALL_INTERESTS, BUDGET_LABEL } from "../types";
import { ToolExecutor } from "../tools";
import { draftOps, findCity, suggestions, airportCode } from "../mock-data";
import { addDays, displayTime, formatDateRange, monthName, normalizeTime, parseDates, toISODate, daysBetween } from "../time";
import { fromHome, turn } from "../greeting";
import { capitalizeWords, containsAny } from "../util";
import { geocode } from "../search";

import type { BotTurn } from "../greeting";
export type { BotTurn };

const DEFAULT_CHIPS = ["Add a food tour on Day 2", "Find flights", "Find hotels", "Looks good, confirm!"];
const TIME = String.raw`(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)`;

export const tripDays = (t: Trip) => (t.startDate && t.endDate ? daysBetween(t.startDate, t.endDate) + 1 : undefined);

/**
 * Offline, rule-based Travel AI that follows the spec's chat flow.
 * Used when GEMINI_API_KEY isn't set, so the whole app can be demoed without an LLM.
 */
export async function mockRespond(req: ChatRequest, tools: ToolExecutor): Promise<BotTurn> {
  const input = req.text.trim();
  const trip = tools.trip;
  const profile = req.profile;

  if (!trip.destination) return handleDestination(input, profile, tools);
  if (!trip.origin || !trip.startDate) return handleOriginAndDates(input, profile, tools);
  if (!trip.travelers || !trip.budget) return handleTravelersAndBudget(input, profile, tools);
  if (!trip.interests?.length) {
    tools.updateTripInfo({ interests: parseInterests(input, profile) });
    return generateDraft(profile, tools);
  }
  if (trip.itinerary.every((d) => d.items.length === 0)) return generateDraft(profile, tools);
  return handleEdit(input, tools);
}

// ── Step 1: destination
async function handleDestination(input: string, profile: UserProfile, tools: ToolExecutor): Promise<BotTurn> {
  const lower = input.toLowerCase();
  const vibes: Record<string, string[]> = {
    beach: ["Bali, Indonesia", "Amalfi Coast, Italy"],
    mountain: ["Banff, Canada", "Interlaken, Switzerland"],
    city: ["Lisbon, Portugal", "Kyoto, Japan"],
    food: ["Kyoto, Japan", "Lisbon, Portugal"],
  };
  const vibe = Object.keys(vibes).find((k) => lower.includes(k));
  if (vibe && !findCity(lower)) {
    const picks = vibes[vibe];
    return turn(`Love that vibe! Here are two places I'd fly to in a heartbeat: ${picks.join(" or ")}. Which one?`, [...picks, "Something else"]);
  }
  if (lower.includes("something else")) {
    return turn("No problem! Tell me a vibe and I'll find the spot.", ["Beach", "Mountains", "City break", "Food trip"]);
  }
  if (containsAny(lower, ["surprise", "bất ngờ", "not sure", "no idea", "don't know", "dont know", "anywhere", "suggest", "idea"])) {
    const ideas = suggestions(profile.interests, new Date().getMonth() + 1);
    const list = ideas.map(([n, why]) => `• ${n} — ${why}`).join("\n");
    return turn(`Ooh, a mystery trip! 🧭 Based on your interests and the season, here's where I'd point my beak:\n${list}\n\nWhich one calls to you?`,
      [...ideas.map(([n]) => n), "Something else"]);
  }
  let dest = input;
  for (const prefix of ["i want to go to ", "i'd like to go to ", "let's go to ", "lets go to ", "go to ", "trip to ", "to "]) {
    if (dest.toLowerCase().startsWith(prefix)) dest = dest.slice(prefix.length);
  }
  dest = dest.replace(/^[\s.!?]+|[\s.!?]+$/g, "");
  if (!dest || dest.length > 60) {
    return turn("Where would you like to go? A city, a country, or just a vibe works!", ["Kyoto, Japan", "Bali, Indonesia", "Surprise me!"]);
  }
  const t = tools.updateTripInfo({ destination: findCity(dest)?.name ?? capitalizeWords(dest) });
  return turn(`${t.destination!.split(",")[0]} — great pick! 🌏 Where are you flying from, and when are you thinking of going?`,
    [fromHome(profile, "5 days next month"), fromHome(profile, "next weekend"), fromHome(profile, `1 week in ${monthName(2)}`)]);
}

// ── Step 2: origin + dates
async function handleOriginAndDates(input: string, profile: UserProfile, tools: ToolExecutor): Promise<BotTurn> {
  const trip = tools.trip;
  let origin: string | undefined;
  const iata = input.match(/\b([A-Z]{3})\b/);
  const from = input.match(/from\s+([a-zA-Z\s]+?)(?:\s*[,·]|\s+on\b|\s+in\b|\s+next\b|\s+for\b|$)/i);
  if (iata) origin = iata[1];
  else if (from) origin = capitalizeWords(from[1].trim());
  else if (containsAny(input, ["home", "usual"])) origin = profile.homeAirport || undefined;

  const parsed = parseDates(input);
  if (!origin && !parsed.start && !parsed.days) {
    return turn("Hmm, I didn't quite catch that. Which airport are you leaving from, and roughly when?",
      [fromHome(profile, "5 days next month"), fromHome(profile, "next weekend")]);
  }
  const start = parsed.start ?? trip.startDate ?? addDays(toISODate(new Date()), 30);
  const days = parsed.days ?? tripDays(trip) ?? 4;
  const t = tools.updateTripInfo({ origin: origin ?? trip.origin ?? profile.homeAirport, startDate: start, endDate: addDays(start, Math.max(0, days - 1)) });
  return turn(
    `Got it — ${t.origin ? `${t.origin} → ` : ""}${t.destination}, ${formatDateRange(t.startDate, t.endDate)} (${days} days). Who's coming along, and what's the budget vibe?`,
    [`Solo · ${BUDGET_LABEL[profile.budgetLevel].toLowerCase()}`, "2 people · mid-range", "2 people · luxury", "Family of 4 · budget"],
  );
}

// ── Step 3: travelers + budget
async function handleTravelersAndBudget(input: string, profile: UserProfile, tools: ToolExecutor): Promise<BotTurn> {
  const lower = input.toLowerCase();
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  let travelers: number | undefined;
  if (containsAny(lower, ["solo", "alone", "just me", "myself"])) travelers = 1;
  else if (lower.includes("couple")) travelers = 2;
  else if (lower.match(/(\d+)/)) travelers = Number(lower.match(/(\d+)/)![1]);
  else { const w = Object.keys(words).find((k) => lower.includes(k)); if (w) travelers = words[w]; }

  let budget = BUDGET_LABEL[profile.budgetLevel];
  if (containsAny(lower, ["budget", "cheap", "backpack", "low"])) budget = "Budget";
  else if (containsAny(lower, ["lux", "splurge", "fancy", "high"])) budget = "Luxury";
  else if (lower.includes("mid")) budget = "Mid-range";

  tools.updateTripInfo({ travelers: travelers ?? 1, budget });
  const chips = profile.interests.length ? [`Use my usual: ${profile.interests.slice(0, 2).join(", ")}`] : [];
  return turn("Perfect. Last question before I start sketching: what are you most excited about on this trip?",
    [...chips, "Temples & History", "Food", "Nature", "Nightlife"]);
}

function parseInterests(input: string, profile: UserProfile): string[] {
  const lower = input.toLowerCase();
  if (containsAny(lower, ["usual", "profile", "same as always"])) return profile.interests;
  const hits = ALL_INTERESTS.filter((i) => i.toLowerCase().split(/[\s&]+/).some((w) => w.length > 3 && lower.includes(w)));
  return hits.length ? hits : [capitalizeWords(input)];
}

// ── Step 4: draft itinerary
async function generateDraft(profile: UserProfile, tools: ToolExecutor): Promise<BotTurn> {
  const trip = tools.trip;
  const dest = trip.destination ?? "";
  const center = findCity(dest) ? undefined : await geocode(dest);
  const days = tripDays(trip) ?? 4;
  const interests = trip.interests ?? profile.interests;
  const result = tools.updateItinerary(draftOps(dest, days, interests, profile.pace, center));

  if (!trip.hotel) {
    const [h] = await tools.searchHotels({ location: dest, checkIn: trip.startDate ?? "", checkOut: trip.endDate ?? "", travelers: trip.travelers ?? 1, budget: trip.budget }, false);
    if (h && (h.lat || h.lng)) tools.setHotel({ name: h.name, lat: h.lat, lng: h.lng, address: h.area });
  }
  const focus = interests.slice(0, 2).join(" & ").toLowerCase();
  return turn(
    `Ta-da! 🗺️ Here's a first draft for ${days} days in ${dest.split(",")[0]} — ${result.changes.length} stops built around ${focus || "the highlights"}, at a ${profile.pace} pace. Peek at the Itinerary tab. What should I tweak?`,
    ["Make Day 1 more relaxed", "Add a food tour on Day 2", "Find flights", "Looks good, confirm!"],
  );
}

// ── Step 5+: edits, searches, confirmation
async function handleEdit(input: string, tools: ToolExecutor): Promise<BotTurn> {
  const lower = input.toLowerCase();
  const trip = tools.trip;
  const dest = trip.destination ?? "";
  const dayIn = (s: string) => { const m = s.match(/day\s*(\d+)/i); return m ? Number(m[1]) : undefined; };
  const hotelQuery = { location: dest, checkIn: trip.startDate ?? "", checkOut: trip.endDate ?? "", travelers: trip.travelers ?? 1, budget: trip.budget };

  if (containsAny(lower, ["confirm", "looks good", "book it", "lock it", "let's do it", "lets do it"])) {
    tools.updateTripInfo({ status: "upcoming" });
    return turn(`Woohoo! ${trip.title} is officially upcoming ✈️ Everything stays synced here. Want me to look at flights or hotels next?`, ["Find flights", "Find hotels"]);
  }

  const stay = input.match(/^stay at (.+)$/i);
  if (stay) {
    const hotels = await tools.searchHotels(hotelQuery, false);
    const h = hotels.find((x) => x.name.toLowerCase() === stay[1].toLowerCase().trim()) ?? hotels[0];
    if (h) {
      tools.setHotel({ name: h.name, lat: h.lat, lng: h.lng, address: h.area });
      return turn(`Nice! ${h.name} is now your base — it's pinned on the map. (Booking comes in a later version.)`, DEFAULT_CHIPS);
    }
  }

  if (lower.includes("flight")) {
    const offers = await tools.searchFlights({
      origin: trip.origin ?? "SGN", destination: airportCode(dest), date: trip.startDate ?? "", returnDate: trip.endDate, travelers: trip.travelers ?? 1,
    });
    return turn(offers.length ? `Here are a few flight options from ${trip.origin} — sample prices for now, live fares are coming soon:` : "I couldn't find flights for those dates.",
      ["Find hotels", "Looks good, confirm!"]);
  }

  if (containsAny(lower, ["hotel", "accommodation", "where to stay", "place to stay"])) {
    const offers = await tools.searchHotels(hotelQuery);
    return turn(`Here are some cozy nests that fit a ${(trip.budget ?? "mid-range").toLowerCase()} budget (sample prices):`,
      offers.slice(0, 2).map((h) => `Stay at ${h.name}`));
  }

  if (containsAny(lower, ["relaxed", "lighter", "less packed", "slower"])) {
    const day = dayIn(lower) ?? 1;
    const d = trip.itinerary.find((x) => x.day === day);
    const victim = d && d.items.length > 2 ? [...d.items].reverse().find((i) => i.category !== "food") ?? d.items[d.items.length - 1] : undefined;
    if (!victim) return turn(`Day ${day} is already nice and chill. 🌿`, DEFAULT_CHIPS);
    tools.updateItinerary([{ action: "remove", day, itemId: victim.id }]);
    return turn(`Done — I dropped ${victim.title} so Day ${day} has room to breathe.`, [`Undo, add ${victim.title} back to Day ${day}`, "Looks good, confirm!"]);
  }

  const add = input.match(new RegExp(String.raw`^(?:please\s+)?(?:undo,\s*)?add\s+(.+?)(?:\s+(?:at|@)\s+${TIME})?(?:\s+(?:back\s+)?(?:on|to|for)\s+day\s*(\d+))?(?:\s+(?:at|@)\s+${TIME})?\s*[.!]?$`, "i"));
  if (add) {
    let name = add[1];
    let time = normalizeTime(add[2] ?? add[4]);
    const day = add[3] ? Number(add[3]) : dayIn(lower) ?? lightestDay(trip);
    const phrases: [string, string][] = [[" in the morning", "09:00"], [" for breakfast", "08:00"], [" for lunch", "12:30"], [" in the afternoon", "15:00"], [" for dinner", "19:00"], [" in the evening", "19:00"]];
    for (const [ph, t] of phrases) if (name.toLowerCase().includes(ph)) { name = name.replace(new RegExp(ph, "i"), ""); time ??= t; }
    name = name.replace(/^(a|an|the)\s+/i, "").trim();

    const existing = new Set(trip.itinerary.flatMap((d) => d.items.map((i) => i.title.toLowerCase())));
    const type = containsAny(name, ["food", "lunch", "dinner", "restaurant", "cafe", "eat"]) ? "food" : undefined;
    const results = await tools.searchPlaces({ query: name, near: dest, type }, false);
    const place = results.find((r) => !existing.has(r.name.toLowerCase())) ?? results[0];
    if (!place) return turn(`I couldn't find ${name} near ${dest}. Could you give me a bit more detail?`, DEFAULT_CHIPS);
    const at = time ?? (place.type === "food" ? "12:30" : "10:00");
    tools.updateItinerary([{ action: "add", day, item: { time: at, title: place.name, placeId: place.placeId, lat: place.lat, lng: place.lng, note: place.note ?? "", category: place.type, estCost: place.estCost ?? 0, imageUrl: place.imageUrl } }]);
    return turn(`Done! ${place.name} is on Day ${day} at ${displayTime(at)}. ${place.note ?? ""}`.trim(), ["Find a lunch spot nearby", "Looks good, confirm!"]);
  }

  const remove = input.match(/^(?:please\s+)?(?:remove|delete|drop|skip|cancel)\s+(?:the\s+)?(.+?)(?:\s+(?:on|from)\s+day\s*(\d+))?\s*[.!]?$/i);
  if (remove) {
    const r = tools.updateItinerary([{ action: "remove", day: remove[2] ? Number(remove[2]) : 1, item: { title: remove[1] } }]);
    return turn(r.changes.length ? `Gone! ${r.changes.join(", ")}.` : `Hmm, I couldn't find ${remove[1]} in your plan.`, DEFAULT_CHIPS);
  }

  const move = input.match(new RegExp(String.raw`^(?:please\s+)?move\s+(?:the\s+)?(.+?)\s+to\s+(?:day\s*(\d+))?\s*(?:at\s+)?${TIME}?\s*[.!]?$`, "i"));
  if (move && (move[2] || move[3])) {
    const toDay = move[2] ? Number(move[2]) : undefined;
    const r = tools.updateItinerary([{ action: "move", day: toDay ?? 1, item: { title: move[1], time: move[3] }, toDay }]);
    return turn(r.changes.length ? `Shuffled! ${r.changes.join(", ")}.` : `Hmm, I couldn't find ${move[1]} in your plan.`, DEFAULT_CHIPS);
  }

  if (containsAny(lower, ["restaurant", "lunch", "dinner", "eat", "cuisine", "food", "hungry"])) {
    const places = await tools.searchPlaces({ query: input, near: dest, type: "food" });
    const day = dayIn(lower) ?? 1;
    return turn(places.length ? "Here are some tasty spots near your plan 🍜" : "I couldn't find food spots nearby.",
      places.slice(0, 2).map((p) => `Add ${p.name} to Day ${day}`));
  }

  if (containsAny(lower, ["later", "no thanks", "nope"]) || lower === "no") return turn("No problem! Anything else you'd like to tweak?", DEFAULT_CHIPS);

  return turn(
    "I'm running in offline demo mode 🐦 so I understand things like “add Nishiki Market at 9am on Day 2”, “remove Nijo Castle”, “move Gion to Day 3”, “find flights” or “find hotels”.",
    DEFAULT_CHIPS,
  );
}

function lightestDay(trip: Trip): number {
  return [...trip.itinerary].sort((a, b) => a.items.length - b.items.length)[0]?.day ?? 1;
}
