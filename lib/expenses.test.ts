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
