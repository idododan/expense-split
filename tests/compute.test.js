"use strict";
// node --test tests/ — the balance rule (SPEC §5) against the sample feed.
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var core = require("../app.js");

var root = path.join(__dirname, "..");
function load(p) { return JSON.parse(fs.readFileSync(path.join(root, p), "utf8")); }
var feed = load("handover/samples/expenses-mgs.json");
var acc = load("data-local/mgs/accounting.json");
var r2 = core.round2;

test("brief §6: MGS Anthropic since 2026-06-07 = $1,020.51 over 35 rows", function () {
  var m = core.compute(feed, acc, { ilsPerUsd: 3.0, only: ["Anthropic"] });
  assert.equal(r2(m.total), 1020.51);
  assert.equal(m.nCounted, 35);
});

test("brief §6: after Guy's last payment (2026-08-13) = $347.31 over 7 rows", function () {
  var m = core.compute(feed, acc, { ilsPerUsd: 3.0, only: ["Anthropic"] });
  assert.equal(m.lastSettlement.date, "2026-08-13");
  assert.equal(r2(m.sinceLast), 347.31);
  assert.equal(m.nSince, 7);
  var dates = m.rows.filter(function (r) { return r.counted && r.after; }).map(function (r) { return r.date; }).sort();
  assert.deepEqual(dates, ["2026-08-15", "2026-09-07", "2026-09-09", "2026-10-07", "2026-10-24", "2026-10-24", "2026-11-07"]);
});

test("balance = share − settlements (shekel payments at their own dates' rates)", function () {
  var rate = 3.0;
  var m = core.compute(feed, acc, { ilsPerUsd: rate, only: ["Anthropic"] });
  var guy = m.balances[0];
  assert.equal(guy.partner, "Guy");
  var paid = 65.39 + 347 / 3.0139 + 465 / 2.981; // each payment at its own date's rate
  assert.equal(r2(guy.paid), r2(paid));
  assert.equal(r2(guy.balance), r2(1020.51 / 2 - paid));
  assert.equal(r2(guy.sinceShare), 173.66);
});

test("history: feed rows win, pre-start rows stay visible and unsplit", function () {
  var m = core.compute(feed, acc, { ilsPerUsd: 3.0 });
  var hist = m.rows.filter(function (r) { return r.origin === "history"; });
  assert.equal(hist.length, 9); // 25 old-page rows, 16 of them are in the feed
  hist.forEach(function (r) { assert.equal(r.skip, "before the accounting start"); });
  var refs = m.rows.map(function (r) { return r.reference; }).filter(Boolean);
  assert.equal(refs.length, new Set(refs).size);
  // descriptions carry over from the old page
  var jun13 = m.rows.find(function (r) { return r.reference === "2595-5003-9268"; });
  assert.equal(jun13.origin, "feed");
  assert.equal(jun13.amount, 90.54);
  assert.match(jun13.desc, /Max plan/);
});

test("vendors '*': every receipt counts; null amounts are shown, not summed", function () {
  var m = core.compute(feed, acc, { ilsPerUsd: 3.0 });
  assert.equal(m.nCounted, 37);
  // 4 rows without an amount + the 019 SMS row (₪29.50, needs_parsing): shown, not summed
  assert.equal(m.rows.filter(function (r) { return r.unparsed; }).length, 5);
  assert.equal(m.byMerchant["019 SMS"], undefined);
  assert.equal(r2(m.total), r2(1020.51 + 12 + 5.68));
});

test("a history row without a feed row counts; exclusions and adjustments apply", function () {
  var a = JSON.parse(JSON.stringify(acc));
  a.history.push({ date: "2026-09-01", merchant: "Anthropic", reference: "X-1", amount: 40, currency: "USD", desc: "", paid_by: "Ido" });
  a.excluded = ["2751-7983-9032"];        // Sep 7 $100, by reference
  a.adjustments = [{ date: "2026-09-02", partner: "Guy", amount: -5, currency: "USD", note: "" }];
  var base = core.compute(feed, acc, { ilsPerUsd: 3.0 });
  var m = core.compute(feed, a, { ilsPerUsd: 3.0 });
  assert.equal(r2(m.total), r2(base.total + 40 - 100));
  assert.equal(r2(m.balances[0].balance), r2(base.balances[0].balance + 20 - 50 - 5));
});

test("no settlement yet → since-last is everything since the start (YourRights)", function () {
  var m = core.compute(load("handover/samples/expenses-yourrights.json"), load("data-local/yourrights/accounting.json"), { ilsPerUsd: 3.0 });
  assert.equal(m.lastSettlement, null);
  assert.equal(r2(m.sinceLast), r2(m.total));
  assert.equal(m.balances[0].partner, "Omri");
  assert.equal(r2(m.balances[0].carried), 0);
});

test("describe() strips vendor boilerplate", function () {
  assert.equal(core.describe("Your receipt from Anthropic, PBC #2055-4744-5590", "Anthropic", "Anthropic, PBC", "2055-4744-5590"), "");
  assert.equal(core.describe("receipt 019 sms", "019 SMS", null, null), "");
  assert.equal(core.describe("Welcome to Supabase", "Supabase", null, null), "Welcome to Supabase");
});

test("a payment with its own rate does not move with today's rate", function () {
  var a = JSON.parse(JSON.stringify(acc));
  a.settlements[2].ils_per_usd = 3.1;                // ₪465 on Aug 13
  delete a.settlements[1].ils_per_usd;               // ₪347 on Jul 14: no rate, so today's
  var x = core.compute(feed, a, { ilsPerUsd: 3.0, only: ["Anthropic"] });
  var y = core.compute(feed, a, { ilsPerUsd: 4.0, only: ["Anthropic"] });
  assert.equal(r2(x.settlements[2].value), r2(465 / 3.1));
  assert.equal(r2(y.settlements[2].value), r2(465 / 3.1));
  assert.equal(r2(x.balances[0].paid - y.balances[0].paid), r2(347 / 3.0 - 347 / 4.0)); // Jul 14 still floats
});
