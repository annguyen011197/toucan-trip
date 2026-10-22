import { test } from "node:test";
import assert from "node:assert/strict";
import { convertAmount, parseAmount, summarizeExpenses } from "./expenses";
import type { TripExpense } from "./types";

const exp = (p: Partial<TripExpense>): TripExpense => ({
  id: Math.random().toString(36), tripId: "t", title: "x", amount: 0, currency: "VND", category: "food", note: "",
  authorId: "a", authorName: "An", spentAt: 0, createdAt: 0, ...p,
});

const rates = { USD: 1, VND: 25_000, JPY: 150 };

test("convertAmount goes through USD and knows unknown currencies", () => {
  assert.equal(convertAmount(150, "JPY", "VND", rates), 25_000);
  assert.equal(convertAmount(7, "VND", "VND", {}), 7);
  assert.equal(convertAmount(1, "XYZ", "VND", rates), undefined);
});

test("summarizeExpenses totals by day, category, stop and person in the trip currency", () => {
  const s = summarizeExpenses([
    exp({ amount: 100_000, day: 1, itemId: "i1" }),
    exp({ amount: 300, currency: "JPY", day: 1, category: "transport", authorId: "b", authorName: "Bình" }),
    exp({ amount: 20_000, category: "shopping" }),
    exp({ amount: 5, currency: "XYZ" }),
  ], "VND", rates);
  assert.equal(s.total, 170_000);
  assert.equal(s.converted, true);
  assert.equal(s.skipped, 1);
  assert.deepEqual(s.byDay, { 0: 20_000, 1: 150_000 });
  assert.deepEqual(s.byCategory, { food: 100_000, transport: 50_000, shopping: 20_000 });
  assert.deepEqual(s.byItem, { i1: 100_000 });
  assert.deepEqual(s.byPerson, { a: { name: "An", total: 120_000 }, b: { name: "Bình", total: 50_000 } });
});

test("parseAmount handles both decimal styles and grouping", () => {
  assert.equal(parseAmount("1.250.000"), 1_250_000);
  assert.equal(parseAmount("1,250,000"), 1_250_000);
  assert.equal(parseAmount("120.000 ₫"), 120_000);
  assert.equal(parseAmount("12,5"), 12.5);
  assert.equal(parseAmount("12.50"), 12.5);
  assert.equal(parseAmount("1,250.75"), 1250.75);
  assert.equal(parseAmount("1.000,50"), 1000.5);
  assert.equal(parseAmount("abc"), undefined);
});

test("splitEqually gives every smallest unit to someone", async () => {
  const { splitEqually } = await import("./expenses");
  const p = [{ key: "a", name: "A" }, { key: "b", name: "B" }, { key: "c", name: "C" }];
  assert.deepEqual(splitEqually(100_000, p, "VND").map((s) => s.amount), [33_334, 33_333, 33_333]);
  assert.deepEqual(splitEqually(10, p, "USD").map((s) => s.amount), [3.34, 3.33, 3.33]);
});

test("balances and settle-up across payers, splits and currencies", async () => {
  const { computeBalances, settleUp, splitEqually } = await import("./expenses");
  const people = [{ key: "a", name: "An" }, { key: "b", name: "Bình" }, { key: "c", name: "Chi" }];
  const balances = computeBalances([
    // An pays 300k for everyone.
    exp({ amount: 300_000, paidBy: people[0], split: { mode: "equal", shares: splitEqually(300_000, people, "VND") } }),
    // Bình pays ¥600 (= 100k), only An and Bình share it.
    exp({ amount: 600, currency: "JPY", paidBy: people[1], split: { mode: "exact", shares: [{ ...people[0], amount: 200 }, { ...people[1], amount: 400 }] } }),
    // Chi's own coffee: no split, no debt.
    exp({ amount: 50_000, authorId: "c", authorName: "Chi" }),
  ], "VND", { USD: 1, VND: 25_000, JPY: 150 });
  const net = Object.fromEntries(balances.map((b) => [b.key, Math.round(b.net)]));
  assert.deepEqual(net, { a: 166_667, b: -66_667, c: -100_000 });
  const transfers = settleUp(balances, "VND").map((t) => `${t.from.key}->${t.to.key}:${Math.round(t.amount)}`);
  assert.deepEqual(transfers, ["c->a:100000", "b->a:66667"]);
});

test("guessCategory reads Vietnamese and English", async () => {
  const { guessCategory } = await import("./expenses");
  assert.equal(guessCategory("Grab ra sân bay", "food"), "transport");
  assert.equal(guessCategory("Vé tàu Shinkansen", "sight"), "transport");
  assert.equal(guessCategory("Vé vào chùa Kinkaku-ji", "other"), "sight");
  assert.equal(guessCategory("Phở bò", "other"), "food");
  assert.equal(guessCategory("Bia ở bar", "food"), "nightlife");
  assert.equal(guessCategory("abc", "other"), "other");
});

test("rekeyExpense moves a virtual traveler's payment and shares to a real member", async () => {
  const { rekeyExpense } = await import("./expenses");
  const v = { key: "traveler:1", name: "Minh" }, me = { key: "u1", name: "Minh" }, b = { key: "u2", name: "Bình" };
  assert.equal(rekeyExpense({ paidBy: b }, v.key, me), undefined);
  const r = rekeyExpense({ paidBy: v, split: { mode: "exact", shares: [{ ...v, amount: 30 }, { ...me, amount: 20 }, { ...b, amount: 50 }] } }, v.key, me);
  assert.deepEqual(r?.paidBy, me);
  assert.deepEqual(r?.split?.shares.map((s) => [s.key, s.amount]), [["u1", 50], ["u2", 50]]);
});
