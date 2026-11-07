#!/usr/bin/env node
// Print the numbers the page computes for a project, from its local files.
// Usage: node tools/report.js <project> [ilsPerUsd] [--only=Anthropic]
"use strict";
var fs = require("fs");
var path = require("path");
var core = require("../app.js");

var args = process.argv.slice(2);
var only = null;
args = args.filter(function (a) {
  if (a.indexOf("--only=") === 0) { only = a.slice(7).split(","); return false; }
  return true;
});
var id = args[0] || "mgs";
var rate = args[1] ? parseFloat(args[1]) : core.FALLBACK_ILS_PER_USD;
var root = path.join(__dirname, "..");
var cfg = JSON.parse(fs.readFileSync(path.join(root, "projects.json"), "utf8")).projects[id];
if (!cfg) { console.error("unknown project " + id); process.exit(1); }
var feed = JSON.parse(fs.readFileSync(path.join(root, cfg.local.expenses), "utf8"));
var acc = JSON.parse(fs.readFileSync(path.join(root, cfg.local.accounting), "utf8"));
var m = core.compute(feed, acc, { ilsPerUsd: rate, only: only });
function $(n) { return "$" + n.toFixed(2); }

console.log(cfg.name + (only ? " (only " + only.join(", ") + ")" : "") + " · 1 USD = ₪" + rate);
console.log("since " + m.accountingStart + ": " + $(m.total) + " over " + m.nCounted + " counted rows");
Object.keys(m.byMerchant).sort().forEach(function (k) { console.log("  " + k.padEnd(12) + $(m.byMerchant[k])); });
console.log("last payment: " + (m.lastSettlement ? m.lastSettlement.date : "none"));
console.log("since last payment: " + $(m.sinceLast) + " over " + m.nSince + " rows");
m.rows.filter(function (r) { return r.counted && r.after; }).forEach(function (r) {
  console.log("  " + r.date + " " + r.merchant.padEnd(10) + " " + $(r.value));
});
m.balances.forEach(function (b) {
  console.log(b.partner + ": share " + $(b.share) + " − paid " + $(b.paid) + " + adj " + $(b.adjustments) +
    " = owes " + $(b.balance) + "  (half of since-last " + $(b.sinceShare) + ", carried over " + $(b.carried) + ")");
});
var unparsed = m.rows.filter(function (r) { return r.unparsed; });
if (unparsed.length) console.log("not summed (no amount): " + unparsed.map(function (r) { return r.date + " " + r.merchant; }).join(", "));
var skipped = m.rows.filter(function (r) { return r.skip; });
if (skipped.length) console.log("not split: " + skipped.length + " rows (" + skipped.map(function (r) { return r.skip; })
  .filter(function (v, i, a) { return a.indexOf(v) === i; }).join(", ") + ")");
m.warnings.forEach(function (w) { console.log("⚠ " + w); });
