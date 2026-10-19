import type { ItemCategory, ItineraryDay, ItineraryItem, ItineraryItemPatch, ItineraryOp } from "./types";
import { addDays, minutesOf, normalizeTime, displayTime } from "./time";
import { uid } from "./util";
import { translator, type Lang } from "./i18n";

export interface EngineResult {
  itinerary: ItineraryDay[];
  changes: string[];
  failures: string[];
}

export function lenientCategory(raw?: string): ItemCategory {
  switch ((raw ?? "").toLowerCase()) {
    case "food": case "restaurant": case "cafe": case "lunch": case "dinner": case "breakfast": case "meal": return "food";
    case "sight": case "sightseeing": case "temple": case "museum": case "landmark": case "attraction": case "culture": return "sight";
    case "activity": case "nature": case "hike": case "tour": case "experience": return "activity";
    case "transport": case "transit": case "flight": case "train": return "transport";
    case "hotel": case "lodging": case "stay": return "hotel";
    case "shopping": case "market": return "shopping";
    case "nightlife": case "bar": case "night": return "nightlife";
    default: return "other";
  }
}

const clone = (days: ItineraryDay[]): ItineraryDay[] => days.map((d) => ({ ...d, items: d.items.map((i) => ({ ...i })) }));

/** Pure itinerary mutations. Every write path (chat tools, drag-to-reorder) goes through here. */
/** `lang` is the language of the change log shown in chat. */
export function applyOps(ops: ItineraryOp[], itinerary: ItineraryDay[], startDate?: string, lang: Lang = "en"): EngineResult {
  const t = translator(lang);
  const time = (hhmm: string) => displayTime(hhmm, lang);
  const days = clone(itinerary);
  const changes: string[] = [];
  const failures: string[] = [];

  const ensureDay = (day: number) => {
    for (let d = 1; d <= day; d++) {
      if (!days.some((x) => x.day === d)) days.push({ day: d, date: startDate ? addDays(startDate, d - 1) : undefined, items: [] });
    }
    days.sort((a, b) => a.day - b.day);
  };
  const insertSorted = (item: ItineraryItem, day: number) => {
    const d = days.find((x) => x.day === day);
    if (!d) return;
    const pos = d.items.findIndex((i) => minutesOf(i.time) > minutesOf(item.time));
    d.items.splice(pos < 0 ? d.items.length : pos, 0, item);
  };
  const locate = (op: ItineraryOp): { d: ItineraryDay; idx: number } | undefined => {
    const id = op.itemId ?? op.item?.id;
    if (id) {
      for (const d of days) { const idx = d.items.findIndex((i) => i.id === id); if (idx >= 0) return { d, idx }; }
    }
    const q = op.item?.title?.toLowerCase().trim();
    if (!q) return undefined;
    const match = (i: ItineraryItem) => { const t = i.title.toLowerCase(); return t === q || t.includes(q) || q.includes(t); };
    const ordered = [...days.filter((d) => d.day === op.day), ...days.filter((d) => d.day !== op.day)];
    for (const d of ordered) { const idx = d.items.findIndex(match); if (idx >= 0) return { d, idx }; }
    return undefined;
  };
  const makeItem = (p: ItineraryItemPatch, title: string): ItineraryItem => ({
    id: p.id ?? uid(),
    time: normalizeTime(p.time) ?? "12:00",
    title,
    placeId: p.placeId,
    address: p.address,
    lat: p.lat ?? 0,
    lng: p.lng ?? 0,
    note: p.note ?? "",
    category: lenientCategory(p.category),
    estCost: p.estCost ?? 0,
    imageUrl: p.imageUrl,
    tags: p.tags,
  });

  for (const op of ops) {
    switch (op.action) {
      case "add": {
        const title = op.item?.title?.trim();
        if (!op.item || !title) { failures.push(`Add on Day ${op.day}: missing item title`); break; }
        const item = makeItem(op.item, title);
        ensureDay(Math.max(1, op.day));
        insertSorted(item, Math.max(1, op.day));
        changes.push(t("change.added", { title: item.title, day: op.day, time: time(item.time) }));
        break;
      }
      case "remove": {
        const loc = locate(op);
        if (!loc) { failures.push(`Couldn't find ${op.item?.title ?? op.itemId ?? "item"} to remove`); break; }
        const [removed] = loc.d.items.splice(loc.idx, 1);
        changes.push(t("change.removed", { title: removed.title, day: loc.d.day }));
        break;
      }
      case "edit": {
        const loc = locate(op);
        if (!loc || !op.item) { failures.push(`Couldn't find ${op.item?.title ?? op.itemId ?? "item"} to edit`); break; }
        const [item] = loc.d.items.splice(loc.idx, 1);
        const oldTime = item.time;
        const before = { title: item.title, lat: item.lat, lng: item.lng };
        const p = op.item;
        const nt = normalizeTime(p.time);
        if (nt) item.time = nt;
        if (op.itemId && p.title) item.title = p.title; // title is the locator unless targeting by id
        if (p.placeId !== undefined) item.placeId = p.placeId;
        if (p.address !== undefined) item.address = p.address;
        if (p.lat !== undefined) item.lat = p.lat;
        if (p.lng !== undefined) item.lng = p.lng;
        if (p.note !== undefined) item.note = p.note;
        if (p.category !== undefined) item.category = lenientCategory(p.category);
        if (p.estCost !== undefined) item.estCost = p.estCost;
        if (p.imageUrl !== undefined) item.imageUrl = p.imageUrl;
        // A Wikipedia photo belonged to the old place: look again. (User uploads / AI images are kept.)
        if (item.imageCredit?.url?.includes("wikimedia.org") && p.imageUrl === undefined
          && (item.title !== before.title || item.lat !== before.lat || item.lng !== before.lng)) {
          item.imageUrl = item.imageCredit = item.imageSearched = undefined;
        }
        if (p.tags !== undefined) item.tags = p.tags;
        insertSorted(item, loc.d.day);
        changes.push(item.time !== oldTime
          ? t("change.movedTime", { title: item.title, time: time(item.time), day: loc.d.day })
          : t("change.updated", { title: item.title, day: loc.d.day }));
        break;
      }
      case "move": {
        const loc = locate(op);
        if (!loc) { failures.push(`Couldn't find ${op.item?.title ?? op.itemId ?? "item"} to move`); break; }
        const [item] = loc.d.items.splice(loc.idx, 1);
        const nt = normalizeTime(op.item?.time);
        if (nt) item.time = nt;
        const fromDay = loc.d.day;
        const target = op.toDay ?? fromDay;
        ensureDay(target);
        const td = days.find((d) => d.day === target)!;
        if (op.toIndex !== undefined) {
          td.items.splice(Math.max(0, Math.min(op.toIndex, td.items.length)), 0, item);
          // Keep time slots ascending: items take over slots in their new order.
          const slots = td.items.map((i) => i.time).sort((a, b) => minutesOf(a) - minutesOf(b));
          td.items.forEach((i, idx) => { i.time = slots[idx]; });
          changes.push(t(fromDay === target ? "change.reordered" : "change.movedDay", { title: item.title, day: target }));
        } else {
          insertSorted(item, target);
          changes.push(t("change.movedDayTime", { title: item.title, day: target, time: time(item.time) }));
        }
        break;
      }
    }
  }
  days.sort((a, b) => a.day - b.day);
  return { itinerary: days, changes, failures };
}

// ───────────── Travel time estimate between consecutive stops ─────────────

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const hasLocation = (i: { lat: number; lng: number }) => !(i.lat === 0 && i.lng === 0);

/** Google Maps search link (no API key). Name + address/destination opens the place page; bare coordinates are the fallback. */
export function googleMapsUrl(item: Pick<ItineraryItem, "title" | "address" | "lat" | "lng">, destination?: string): string {
  const where = item.address ?? destination;
  const query = where ? `${item.title}, ${where}` : hasLocation(item) ? `${item.lat},${item.lng}` : item.title;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function travelLeg(a: ItineraryItem, b: ItineraryItem): { minutes: number; mode: "walk" | "transit" } | undefined {
  if (!hasLocation(a) || !hasLocation(b)) return undefined;
  const km = (distanceMeters(a, b) / 1000) * 1.3; // street detour factor
  if (km < 1.5) return { minutes: Math.max(3, Math.round((km / 4.5) * 60)), mode: "walk" };
  return { minutes: Math.max(8, Math.round((km / 22) * 60) + 6), mode: "transit" };
}

export const dayCost = (d?: ItineraryDay) => (d ? d.items.reduce((s, i) => s + (i.estCost || 0), 0) : 0);
