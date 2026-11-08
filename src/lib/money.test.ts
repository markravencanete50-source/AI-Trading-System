import { test } from "node:test";
import assert from "node:assert/strict";
import { computePortfolio, roundQty } from "./money.ts";
import type { Tx } from "./types.ts";

const tx = (p: Partial<Tx>): Tx => ({
  id: Math.random().toString(), brokerId: "col", type: "deposit", date: "2026-01-01", amount: 0,
  currency: "PHP", fxToPhp: 1, source: "manual", status: "confirmed", createdAt: "2026-01-01T00:00:00Z", ...p,
});

test("average cost, partial sell and realized P&L", () => {
  const pf = computePortfolio([{ id: "col", market: "PH" }], [
    tx({ type: "deposit", amount: 50000 }),
    tx({ type: "buy", date: "2026-01-02", ticker: "JFC", qty: 100, price: 140, amount: -14050 }),
    tx({ type: "buy", date: "2026-01-03", ticker: "JFC", qty: 100, price: 150, amount: -15050 }),
    tx({ type: "sell", date: "2026-01-04", ticker: "JFC", qty: 50, price: 160, amount: 7970 }),
  ]);
  const p = pf.positions[0];
  assert.equal(p.qty, 150);
  assert.equal(Math.round(p.cost), 21825);
  assert.equal(Math.round(p.realized), 695);
  assert.equal(pf.cash.col, 50000 - 14050 - 15050 + 7970);
});

test("needs_review rows are ignored", () => {
  const pf = computePortfolio([{ id: "col", market: "PH" }], [tx({ amount: 1000, status: "needs_review" })]);
  assert.equal(pf.cash.col, 0);
});

test("PSE board lots", () => {
  assert.equal(roundQty("PH", 67, 149), 60);
  assert.equal(roundQty("PH", 1234, 15.2), 1200);
  assert.equal(roundQty("US", 9.8, 188), 9);
});
