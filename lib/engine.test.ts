import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps } from "./itinerary-engine";
import { displayTime, normalizeTime, parseDates } from "./time";
import { translator } from "./i18n";
import { convertTripCosts, roundAmount } from "./currency";
import { ToolExecutor } from "./tools";
import { mockRespond } from "./engines/mock";
import { DEFAULT_PROFILE, type Trip } from "./types";

const item = (title: string, time: string, id?: string) => ({ id, time, title, lat: 35, lng: 135, category: "sight" });

test("add inserts sorted by time and creates missing days", () => {
  const r = applyOps([{ action: "add", day: 2, item: item("Lunch", "12:30") }, { action: "add", day: 2, item: item("Kinkaku-ji", "9am") }], []);
  assert.deepEqual(r.itinerary.map((d) => d.day), [1, 2]);
  assert.deepEqual(r.itinerary[1].items.map((i) => i.title), ["Kinkaku-ji", "Lunch"]);
  assert.equal(r.itinerary[1].items[0].time, "09:00");
});

test("remove by fuzzy title", () => {
  const start = applyOps([{ action: "add", day: 1, item: item("Kinkaku-ji (Golden Pavilion)", "10:30") }], []).itinerary;
  const r = applyOps([{ action: "remove", day: 1, item: { title: "kinkaku-ji" } }], start);
  assert.equal(r.itinerary[0].items.length, 0);
});

test("move across days with a new time", () => {
  const start = applyOps([{ action: "add", day: 1, item: item("Gion", "18:00", "g") }, { action: "add", day: 2, item: item("Breakfast", "08:00") }], []).itinerary;
  const r = applyOps([{ action: "move", day: 1, itemId: "g", toDay: 2, item: { time: "7am" } }], start);
  assert.equal(r.itinerary[0].items.length, 0);
  assert.deepEqual(r.itinerary[1].items.map((i) => i.title), ["Gion", "Breakfast"]);
});

test("drag reorder keeps time slots ascending", () => {
  const start = applyOps(["A|08:00", "B|10:00", "C|13:00"].map((s) => {
    const [t, h] = s.split("|");
    return { action: "add" as const, day: 1, item: item(t, h, t) };
  }), []).itinerary;
  const r = applyOps([{ action: "move", day: 1, itemId: "C", toDay: 1, toIndex: 0 }], start);
  assert.deepEqual(r.itinerary[0].items.map((i) => i.title), ["C", "A", "B"]);
  assert.deepEqual(r.itinerary[0].items.map((i) => i.time), ["08:00", "10:00", "13:00"]);
});

test("time & date parsing", () => {
  assert.equal(normalizeTime("9:30 PM"), "21:30");
  assert.equal(normalizeTime("12am"), "00:00");
  assert.equal(normalizeTime("lunch"), undefined);
  assert.equal(parseDates("SGN · 5 days next month").days, 5);
  assert.ok(parseDates("SGN · 5 days next month").start);
  assert.equal(parseDates("1 week in Dec").days, 7);
  assert.equal(parseDates("3 nights").days, 4);
});

test("offline chat flow builds, edits and confirms a trip", async () => {
  let trip: Trip = { id: "t", ownerId: "u", title: "New Trip", status: "dreaming", itinerary: [], currency: "USD", createdAt: 0, updatedAt: 0 };
  const say = async (text: string) => {
    const tools = new ToolExecutor(trip);
    const turn = await mockRespond({ text, trip, history: [], profile: DEFAULT_PROFILE, lang: "en" }, tools);
    trip = tools.trip;
    return { turn, tools };
  };
  await say("Kyoto");
  await say("SGN · 4 days next month");
  await say("2 people · mid-range");
  const draft = await say("Food");
  assert.equal(trip.destination, "Kyoto, Japan");
  assert.equal(trip.origin, "SGN");
  assert.equal(trip.travelers, 2);
  assert.equal(trip.itinerary.length, 4);
  assert.ok(trip.hotel);
  assert.ok(draft.tools.itineraryChanges.length > 8);

  const add = await say("add Nishiki Market at 9am on day 2");
  assert.ok(trip.itinerary[1].items.some((i) => i.title === "Nishiki Market" && i.time === "09:00"));
  assert.equal(add.tools.itineraryChanges.length, 1);

  const flights = await say("Find flights");
  assert.equal(flights.tools.cards.length, 3);
  assert.ok(flights.tools.cards.every((c) => c.kind === "flight" && c.price));

  await say("Looks good, confirm!");
  assert.equal(trip.status, "upcoming");
});

test("change log and times follow the language", () => {
  const r = applyOps([{ action: "add", day: 1, item: item("Chợ Bến Thành", "2pm") }], [], undefined, "vi");
  assert.equal(r.changes[0], "Đã thêm Chợ Bến Thành · Ngày 1, 14:00");
  assert.equal(displayTime("14:00"), "02:00 PM");
  assert.equal(translator("vi")("chat.moreChanges", { n: 3 }), "+3 thay đổi khác");
});

test("currency conversion re-prices every stop and rounds per currency", () => {
  const trip: Trip = {
    id: "t", ownerId: "u", title: "Kyoto", status: "dreaming", currency: "USD", createdAt: 0, updatedAt: 0,
    itinerary: applyOps([{ action: "add", day: 1, item: { ...item("Lunch", "12:00"), estCost: 12.4 } }], []).itinerary,
  };
  const vnd = convertTripCosts(trip, "VND", 25_987);
  assert.equal(vnd.currency, "VND");
  assert.equal(vnd.itinerary[0].items[0].estCost, 322_000);
  assert.equal(roundAmount(1234.5, "JPY"), 1230);
});
