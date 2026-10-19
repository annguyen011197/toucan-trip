import type { ChatMessage, Destination, ItineraryOp, Pace, PlaceResult, Trip } from "./types";
import { IMG } from "./images";
import { applyOps } from "./itinerary-engine";
import { addDays, toISODate } from "./time";
import { uid } from "./util";

export interface City {
  name: string;
  aliases: string[];
  airport: string;
  center: [number, number];
  cover?: string;
  areas: string[];
  hotelNames: string[];
  places: PlaceResult[];
  tip: string;
}

function p(name: string, type: string, lat: number, lng: number, opts: { cost?: number; note: string; image?: string; rating?: number }): PlaceResult {
  const cost = opts.cost ?? 0;
  return {
    placeId: "mock-" + name.toLowerCase().replace(/[^a-z]/g, ""),
    name, type, lat, lng,
    rating: opts.rating ?? 4.6,
    priceLevel: cost > 30 ? 3 : cost > 10 ? 2 : 1,
    estCost: cost,
    note: opts.note,
    imageUrl: opts.image,
  };
}

export const CITIES: City[] = [
  {
    name: "Kyoto, Japan", aliases: ["kyoto"], airport: "KIX", center: [35.0116, 135.7681], cover: IMG.kyotoGoldenTemple,
    areas: ["Gion", "Downtown", "Kyoto Station"], hotelNames: ["Gion Garden Ryokan", "Kamogawa Riverside Hotel", "Sanjo Design Hostel"],
    places: [
      p("Nishiki Market", "food", 35.005, 135.7649, { cost: 20, note: "Start your day with local street food. Try the tamagoyaki and fresh soy milk donuts.", image: IMG.nishikiMarket }),
      p("Kinkaku-ji (Golden Pavilion)", "sight", 35.0394, 135.7292, { cost: 4, note: "Marvel at the Zen temple covered in gold leaf. Best viewed in the morning light.", image: IMG.kinkakuji }),
      p("Zen Lunch & Tea Ceremony", "food", 35.0345, 135.7182, { cost: 45, note: "Enjoy traditional Shojin Ryori (Buddhist vegetarian cuisine) followed by a ceremony." }),
      p("Arashiyama Bamboo Grove", "activity", 35.017, 135.6713, { note: "A meditative walk through the towering bamboo stalks. Great for photography." }),
      p("Fushimi Inari Taisha", "sight", 34.9671, 135.7727, { note: "Thousands of vermilion torii gates. Go early to beat the crowds." }),
      p("Kiyomizu-dera", "sight", 34.9949, 135.785, { cost: 3, note: "Wooden stage temple with sweeping city views." }),
      p("Gion Evening Stroll", "nightlife", 35.0037, 135.7788, { note: "Lantern-lit lanes of the geisha district.", image: IMG.gion }),
      p("Philosopher's Path", "activity", 35.0236, 135.7944, { note: "Canal-side walk lined with cherry trees." }),
      p("Ginkaku-ji (Silver Pavilion)", "sight", 35.027, 135.7982, { cost: 4, note: "Moss gardens and a sand sculpture of Mt. Fuji." }),
      p("Pontocho Alley Dinner", "food", 35.005, 135.7708, { cost: 40, note: "Narrow alley of izakaya overlooking the Kamo River." }),
      p("Shoraian Tofu Kaiseki", "food", 35.013, 135.668, { cost: 35, note: "Tofu course meal in a riverside mountain house." }),
      p("Nijo Castle", "sight", 35.0142, 135.7481, { cost: 6, note: "Shogun castle famous for its 'nightingale' floors." }),
      p("Tenryu-ji Garden", "sight", 35.0158, 135.6738, { cost: 4, note: "UNESCO Zen garden next to the bamboo grove." }),
      p("Menbaka Fire Ramen", "food", 35.02, 135.75, { cost: 15, note: "Ramen set aflame at your table." }),
    ],
    tip: "Consider getting an ICOCA card for seamless travel on the Kyoto bus network.",
  },
  {
    name: "Bali, Indonesia", aliases: ["bali", "ubud", "seminyak"], airport: "DPS", center: [-8.5069, 115.2625],
    areas: ["Ubud", "Seminyak", "Uluwatu"], hotelNames: ["Ubud Jungle Villas", "Seminyak Beach Resort", "Canggu Surf Lodge"],
    places: [
      p("Tegalalang Rice Terrace", "activity", -8.4312, 115.2793, { cost: 3, note: "Iconic emerald terraces — go before 8am." }),
      p("Sacred Monkey Forest", "sight", -8.5188, 115.2585, { cost: 6, note: "Temple ruins and 1,000+ long-tailed macaques." }),
      p("Babi Guling Lunch", "food", -8.507, 115.2615, { cost: 6, note: "Balinese roast pork, a local institution." }),
      p("Campuhan Ridge Walk", "activity", -8.503, 115.2547, { note: "Easy ridge-top walk through alang-alang grass." }),
      p("Tirta Empul Temple", "sight", -8.4152, 115.3153, { cost: 4, note: "Holy spring water temple." }),
      p("Ubud Art Market", "shopping", -8.507, 115.263, { cost: 15, note: "Handicrafts and sarongs — bargain kindly." }),
      p("Uluwatu Temple Sunset", "sight", -8.8291, 115.0849, { cost: 4, note: "Cliff-top temple and Kecak fire dance." }),
      p("Seminyak Beach Club", "nightlife", -8.6913, 115.1569, { cost: 30, note: "Sunset drinks by the ocean." }),
      p("Mount Batur Sunrise Trek", "activity", -8.242, 115.375, { cost: 45, note: "Pre-dawn hike for a sunrise above the clouds." }),
      p("Warung Dinner in Ubud", "food", -8.509, 115.264, { cost: 12, note: "Nasi campur and fresh coconut." }),
    ],
    tip: "Hire a driver for the day — it's often cheaper than taxis between Ubud and the coast.",
  },
  {
    name: "Lisbon, Portugal", aliases: ["lisbon", "lisboa"], airport: "LIS", center: [38.7223, -9.1393],
    areas: ["Baixa", "Alfama", "Príncipe Real"], hotelNames: ["Alfama Tile House", "Baixa Grand Hotel", "LX Design Hostel"],
    places: [
      p("Belém Tower", "sight", 38.6916, -9.216, { cost: 8, note: "16th-century riverside fortress." }),
      p("Jerónimos Monastery", "sight", 38.6979, -9.2068, { cost: 12, note: "Manueline masterpiece." }),
      p("Pastéis de Belém", "food", 38.6975, -9.2032, { cost: 6, note: "The original custard tart, since 1837." }),
      p("Alfama Wander", "activity", 38.7114, -9.13, { note: "Get lost in the oldest neighborhood." }),
      p("São Jorge Castle", "sight", 38.7139, -9.1335, { cost: 15, note: "Moorish castle with the best views." }),
      p("Time Out Market", "food", 38.7071, -9.146, { cost: 20, note: "Food hall of the city's best chefs." }),
      p("Tram 28 Ride", "transport", 38.711, -9.139, { cost: 3, note: "Rattle through the hills on a vintage tram." }),
      p("LX Factory", "shopping", 38.7037, -9.1785, { cost: 10, note: "Creative hub in an old factory." }),
      p("Miradouro da Senhora do Monte", "sight", 38.719, -9.1328, { note: "Sunset viewpoint." }),
      p("Fado in Bairro Alto", "nightlife", 38.713, -9.145, { cost: 35, note: "Soulful fado over dinner." }),
    ],
    tip: "Grab a Viva Viagem card — it works on trams, metro and the ferry.",
  },
  {
    name: "Amalfi Coast, Italy", aliases: ["amalfi", "positano", "ravello"], airport: "NAP", center: [40.634, 14.6027], cover: IMG.amalfiCoast,
    areas: ["Positano", "Amalfi", "Ravello"], hotelNames: ["Positano Cliff Suites", "Amalfi Lemon House", "Ravello Garden Inn"],
    places: [
      p("Positano Beach", "activity", 40.6281, 14.485, { note: "Pastel houses tumbling to the sea." }),
      p("Path of the Gods Hike", "activity", 40.6334, 14.53, { note: "Clifftop trail with jaw-dropping views." }),
      p("Villa Rufolo", "sight", 40.649, 14.6116, { cost: 8, note: "Ravello gardens above the coast." }),
      p("Amalfi Cathedral", "sight", 40.634, 14.6027, { cost: 4, note: "Arab-Norman cathedral and cloister." }),
      p("Seafood Lunch in Amalfi", "food", 40.6339, 14.602, { cost: 45, note: "Scialatielli ai frutti di mare." }),
      p("Fiordo di Furore", "sight", 40.62, 14.549, { note: "A tiny fjord under an arched bridge." }),
      p("Limoncello Tasting", "food", 40.6345, 14.603, { cost: 12, note: "Family-run lemon groves." }),
      p("Sunset Aperitivo in Positano", "nightlife", 40.629, 14.486, { cost: 25, note: "Spritz with a view." }),
    ],
    tip: "Ferries are faster than the coastal bus in summer — buy tickets at the pier.",
  },
  {
    name: "Banff, Canada", aliases: ["banff", "hidden valley", "lake louise"], airport: "YYC", center: [51.1784, -115.5708], cover: IMG.hiddenValley,
    areas: ["Banff Town", "Lake Louise", "Canmore"], hotelNames: ["Bow River Lodge", "Lake Louise Chalet", "Canmore Mountain Inn"],
    places: [
      p("Lake Louise", "activity", 51.4254, -116.1773, { note: "Turquoise glacial lake — rent a canoe." }),
      p("Moraine Lake", "sight", 51.3217, -116.186, { note: "Valley of the Ten Peaks." }),
      p("Banff Gondola", "activity", 51.144, -115.573, { cost: 70, note: "Ride up Sulphur Mountain." }),
      p("Johnston Canyon", "activity", 51.2456, -115.839, { note: "Catwalks to waterfalls." }),
      p("Banff Avenue", "shopping", 51.176, -115.57, { note: "Mountain-town main street." }),
      p("Alpine Bistro Dinner", "food", 51.177, -115.572, { cost: 45, note: "Bison, elk and local craft beer." }),
      p("Upper Hot Springs", "activity", 51.152, -115.561, { cost: 17, note: "Soak with mountain views." }),
    ],
    tip: "Book the Parks Canada shuttle to Moraine Lake — private cars aren't allowed.",
  },
  {
    name: "Interlaken, Switzerland", aliases: ["interlaken", "azure peaks", "swiss alps", "jungfrau"], airport: "ZRH", center: [46.6863, 7.8632], cover: IMG.azurePeaks,
    areas: ["Interlaken", "Grindelwald", "Lauterbrunnen"], hotelNames: ["Jungfrau View Hotel", "Grindelwald Chalet", "Lauterbrunnen Valley Hostel"],
    places: [
      p("Harder Kulm", "activity", 46.697, 7.857, { cost: 40, note: "Funicular to the Two Lakes Bridge." }),
      p("Jungfraujoch", "activity", 46.5475, 7.9853, { cost: 200, note: "Top of Europe — dress warm." }),
      p("Lauterbrunnen Valley", "sight", 46.5935, 7.9091, { note: "72 waterfalls in one valley." }),
      p("Lake Brienz Cruise", "activity", 46.735, 7.95, { cost: 40, note: "Turquoise lake by boat." }),
      p("Grindelwald First Cliff Walk", "activity", 46.659, 8.054, { cost: 70, note: "Cliff walk and mountain carts." }),
      p("Swiss Fondue Dinner", "food", 46.686, 7.86, { cost: 40, note: "Cheese fondue in a cozy taverne." }),
    ],
    tip: "A Swiss Travel Pass or Berner Oberland Pass pays off fast with mountain railways.",
  },
];

export function findCity(text?: string): City | undefined {
  const t = text?.toLowerCase().trim();
  if (!t) return undefined;
  return CITIES.find((c) => t.includes(c.name.toLowerCase().split(",")[0]) || c.aliases.some((a) => t.includes(a)));
}

export function airportCode(destination: string): string {
  if (/^[A-Z]{3}$/.test(destination)) return destination;
  return findCity(destination)?.airport ?? destination.slice(0, 3).toUpperCase();
}

export const HAND_PICKED: Destination[] = [
  { id: "hidden-valley", title: "Hidden Valley", tag: "Nature", imageUrl: IMG.hiddenValley, destination: "Banff, Canada", blurb: "Glacial lakes and quiet trails" },
  { id: "azure-peaks", title: "Azure Peaks", tag: "Adventure", imageUrl: IMG.azurePeaks, destination: "Interlaken, Switzerland", blurb: "Snowy summits and cliff walks" },
  { id: "golden-temples", title: "Golden Temples", tag: "Culture", imageUrl: IMG.kyotoPagoda, destination: "Kyoto, Japan", blurb: "Zen gardens and autumn leaves" },
  { id: "lemon-coast", title: "Lemon Coast", tag: "Coastal", imageUrl: IMG.amalfiCoast, destination: "Amalfi Coast, Italy", blurb: "Cliffside villages and seafood" },
];

export function suggestions(interests: string[], month: number): [string, string][] {
  const lower = interests.map((i) => i.toLowerCase());
  const out: [string, string][] = [];
  if (lower.some((i) => /temple|culture|food/.test(i))) out.push(["Kyoto, Japan", month >= 9 && month <= 11 ? "autumn leaves & temples" : "temples & food"]);
  if (lower.some((i) => /beach|nature/.test(i)) || month < 5 || month > 9) out.push(["Bali, Indonesia", "rice terraces & beaches"]);
  out.push(["Lisbon, Portugal", "sunny viewpoints & pastéis"]);
  out.push(["Banff, Canada", "lakes & mountain trails"]);
  const seen = new Set<string>();
  return out.filter(([n]) => !seen.has(n) && !!seen.add(n)).slice(0, 3);
}

// ───────────── Draft itinerary (offline planner) ─────────────

export function genericPlaces(destination: string, center: [number, number]): PlaceResult[] {
  const city = destination.split(",")[0];
  const specs: [string, string, number, number, number, string][] = [
    [`${city} Old Town Walk`, "activity", 0.004, -0.003, 0, "Get your bearings on foot."],
    ["Local Breakfast Café", "food", 0.002, 0.002, 8, "Coffee and a local pastry."],
    [`${city} History Museum`, "sight", -0.006, 0.004, 12, "The story of the city in one stop."],
    ["Central Market Lunch", "food", 0.001, -0.006, 12, "Graze through the stalls."],
    ["Scenic Viewpoint", "sight", 0.01, 0.008, 0, "Best at golden hour."],
    ["City Park", "activity", -0.009, -0.007, 0, "Green escape for a slow afternoon."],
    ["Signature Dinner", "food", -0.002, 0.005, 35, "A classic local dish."],
    ["Evening Night Market", "nightlife", 0.006, -0.009, 15, "Street food and lights."],
  ];
  return specs.map(([n, t, dl, dg, c, note]) => p(n, t, center[0] + dl, center[1] + dg, { cost: c, note }));
}

function score(pl: PlaceResult, wants: string[]): number {
  let s = 0;
  for (const w of wants) {
    if (w.includes("food") && pl.type === "food") s += 2;
    if (/culture|temple|history|art/.test(w) && pl.type === "sight") s += 2;
    if (/nature|adventure/.test(w) && pl.type === "activity") s += 2;
    if (w.includes("night") && pl.type === "nightlife") s += 2;
    if (w.includes("shop") && pl.type === "shopping") s += 2;
  }
  return s;
}

export function draftOps(destination: string, days: number, interests: string[], pace: Pace, fallbackCenter?: [number, number]): ItineraryOp[] {
  const slots: [string, string[]][] = pace === "packed"
    ? [["08:00", ["food", "sight"]], ["10:30", ["sight", "activity"]], ["13:00", ["food"]], ["15:30", ["activity", "sight", "shopping"]], ["19:00", ["food", "nightlife"]]]
    : [["09:30", ["sight", "activity"]], ["12:30", ["food"]], ["15:30", ["activity", "sight", "shopping"]], ["19:00", ["nightlife", "food"]]];
  const known = findCity(destination);
  const pool = [...(known ? known.places : genericPlaces(destination, fallbackCenter ?? [0, 0]))];
  const wants = interests.map((i) => i.toLowerCase());
  pool.sort((a, b) => score(b, wants) - score(a, wants));

  const used = new Set<string>();
  const ops: ItineraryOp[] = [];
  for (let day = 1; day <= Math.max(1, Math.min(days, 10)); day++) {
    for (const [time, types] of slots) {
      const pick = pool.find((x) => !used.has(x.placeId) && types.includes(x.type)) ?? pool.find((x) => !used.has(x.placeId));
      if (!pick) break;
      used.add(pick.placeId);
      ops.push({ action: "add", day, item: { time, title: pick.name, placeId: pick.placeId, lat: pick.lat, lng: pick.lng, note: pick.note ?? "", category: pick.type, estCost: pick.estCost ?? 0, imageUrl: pick.imageUrl } });
    }
    if (used.size >= pool.length) used.clear();
  }
  return ops;
}

// ───────────── Seed data ─────────────

const botMsg = (text: string, quickReplies: string[] = [], createdAt = Date.now()): ChatMessage =>
  ({ id: uid(), role: "bot", type: quickReplies.length ? "quickReplies" : "text", text, quickReplies, cards: [], createdAt });

export function seedTrips(ownerId: string): { trip: Trip; messages: ChatMessage[] }[] {
  const today = toISODate(new Date());
  const now = Date.now();

  const amalfiStart = addDays(today, 24);
  const amalfi: Trip = {
    id: uid(), ownerId, title: "Amalfi Coast, Italy", destination: "Amalfi Coast, Italy", origin: "SGN",
    startDate: amalfiStart, endDate: addDays(amalfiStart, 7), travelers: 2, budget: "Mid-range", interests: ["Food", "Nature"],
    status: "upcoming", coverImageUrl: IMG.amalfiCoast, itinerary: [], currency: "USD",
    hotel: { name: "Amalfi Lemon House", lat: 40.6352, lng: 14.601, address: "Amalfi" },
    createdAt: now - 7200_000, updatedAt: now - 60_000,
  };
  amalfi.itinerary = applyOps(draftOps("Amalfi Coast, Italy", 3, ["Food", "Nature"], "relaxed"), [], amalfiStart).itinerary;

  const kyotoStart = addDays(today, 36);
  const k = findCity("kyoto")!.places;
  const add = (day: number, time: string, pl: PlaceResult, tags?: string[]): ItineraryOp => ({
    action: "add", day, item: { time, title: pl.name, placeId: pl.placeId, lat: pl.lat, lng: pl.lng, note: pl.note, category: pl.type, estCost: pl.estCost, imageUrl: pl.imageUrl, tags },
  });
  const kyoto: Trip = {
    id: uid(), ownerId, title: "Kyoto Adventure", destination: "Kyoto, Japan", origin: "SGN",
    startDate: kyotoStart, endDate: addDays(kyotoStart, 3), travelers: 2, budget: "Mid-range", interests: ["Temples & History", "Food"],
    status: "dreaming", coverImageUrl: IMG.kyotoPagoda, itinerary: [], currency: "USD",
    hotel: { name: "Gion Garden Ryokan", lat: 35.0029, lng: 135.7756, address: "Gion, Kyoto" },
    createdAt: now - 3600_000, updatedAt: now,
  };
  kyoto.itinerary = applyOps([
    add(1, "08:00", k[0]), add(1, "10:30", k[1], ["Must see", "UNESCO site"]), add(1, "13:00", k[2]), add(1, "15:30", k[3]),
    add(2, "07:30", k[4]), add(2, "11:00", k[5]), add(2, "13:00", k[9]), add(2, "18:30", k[6]),
    add(3, "09:30", k[7]), add(3, "11:00", k[8]), add(3, "13:30", k[13]), add(3, "16:00", k[11]),
    add(4, "09:30", k[12]), add(4, "12:30", k[10]),
  ], [], kyotoStart).itinerary;

  const base = now - 3600_000;
  const kyotoMsgs: ChatMessage[] = [
    botMsg("I've been soaring over some maps and I've found some hidden gems in Kyoto! Based on your love for zen gardens, how does a temple tour on Day 2 sound?", [], base),
    { id: uid(), role: "user", type: "text", text: "That sounds perfect. Let's add Kinkaku-ji in the morning before it gets too crowded.", quickReplies: [], cards: [], createdAt: base + 20_000 },
    { id: uid(), role: "bot", type: "itineraryUpdate", text: "", quickReplies: [], createdAt: base + 40_000,
      cards: [{ id: uid(), kind: "itineraryUpdate", title: "Itinerary updated", changes: ["Added Kinkaku-ji (Golden Pavilion) · Day 1, 10:30 AM"] }] },
    botMsg("Great choice. Kinkaku-ji (The Golden Pavilion) is stunning in the morning light. I've updated the itinerary. Would you like a lunch recommendation nearby?", ["Yes, Japanese cuisine", "Maybe later"], base + 60_000),
  ];
  const amalfiMsgs = [botMsg("Your Amalfi Coast trip is confirmed! 🍋 Want me to look at hotels or add a boat tour?", ["Find hotels", "Add a boat tour on Day 2"], now - 60_000)];
  return [{ trip: kyoto, messages: kyotoMsgs }, { trip: amalfi, messages: amalfiMsgs }];
}
