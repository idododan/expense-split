#!/usr/bin/env node
/* Runs computeLedger (SPEC §4) from app.js against the local MGS data and fixed cases.
 *   node tools/test_ledger.js
 */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var app = require(path.join(root, 'app.js'));

var failures = 0, checks = 0;
function eq(name, got, want) {
  checks++;
  var ok = typeof want === 'number' ? Math.abs(got - want) < 0.005 : got === want;
  if (!ok) { failures++; console.log('  FAIL ' + name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}
function load(p) { return JSON.parse(fs.readFileSync(path.join(root, p), 'utf8')); }

// ── 1. MGS parity numbers from the brief (Anthropic only, like the old page) ──
console.log('MGS, Anthropic only');
var feed = load('local/mgs/expenses.json');
var acc = load('local/mgs/accounting.json');
var RATE = 3.6;                                                 // fixed USD→ILS for the test
var accClaude = Object.assign({}, acc, { vendors: ['Anthropic'] });
var L = app.computeLedger(feed, accClaude, { ILS: RATE });
eq('counted rows', L.counted.length, 35);
eq('total', L.total, 1020.51);
eq('last payment', L.lastPayment, '2026-08-13');
eq('since-last rows', L.sinceRows.length, 7);
eq('since-last', L.sinceLast, 347.31);
var guy = L.partners[0];
eq('partner', guy.name, 'Guy');
var paidWant = acc.settlements.reduce(function (sum, s) {          // the file's own recorded rates win
  var r = s.currency === 'USD' ? 1 : (s.rate || s.ils_per_usd || RATE);
  return sum + s.amount / r;
}, 0);
eq('paid', guy.paid, paidWant);
eq('balance', guy.balance, 1020.51 / 2 - paidWant);
eq('carried', guy.carried, guy.balance - 347.31 / 2);
eq('live field names: by / desc understood', L.lastPayment, '2026-08-13');
eq('before-start history rows not counted', L.rows.filter(function (r) { return r.reason === 'before_start'; }).length, 9);
eq('history rows all matched by the feed (none counted twice)', L.rows.filter(function (r) { return r.source === 'history' && r.date >= '2026-06-07'; }).length, 0);
var maxPlan = L.rows.filter(function (r) { return r.reference === '2255-1861-9763'; })[0];
eq('matched row keeps the old description', maxPlan.description, 'Max plan – 5x (Jul 13–Aug 13)');
eq('matched row uses the feed amount', L.rows.filter(function (r) { return r.reference === '2595-5003-9268'; })[0].amount, 90.54);

// ── 2. MGS, every vendor (the real configuration) ──
console.log('MGS, all vendors');
L = app.computeLedger(feed, acc, { ILS: RATE });
eq('counted rows', L.counted.length, 38);
eq('total', L.total, 1020.51 + 12 + 5.68 + 29.5 / RATE);
eq('pending rows', L.pending, 4);
eq('019 SMS row is this project’s part, not divided again', L.rows.filter(function (r) { return r.merchant === '019 SMS'; })[0].value, 29.5 / RATE);

// ── 3. fixed cases ──
console.log('fixed cases');
var small = {
  schema: 1, project: 't', accounting_start: '2026-01-10', display_currency: 'USD', paid_by: 'A',
  partners: [{ name: 'A', share: 0.5 }, { name: 'B', share: 0.5 }], vendors: '*',
  history: [
    { date: '2026-01-01', merchant: 'X', description: 'old', amount: 100, currency: 'USD', reference: 'r0' },   // before start
    { date: '2026-01-15', merchant: 'X', description: 'hist only', amount: 10, currency: 'USD', reference: 'r1' },
    { date: '2026-01-16', merchant: 'X', description: 'dup', amount: 999, currency: 'USD', reference: 'r2' }     // matched by feed
  ],
  settlements: [{ id: 'p1', date: '2026-01-20', paid_by: 'B', amount: 36, currency: 'ILS', note: '' }],
  adjustments: [{ date: '2026-01-21', partner: 'B', amount: -1, currency: 'USD', note: 'rounding' }],
  excluded: ['f3']
};
var sfeed = { expenses: [
  { id: 'f2', date: '2026-01-16', merchant: 'X', reference: 'r2', amount: 20, currency: 'USD', status: 'ok', subject: 'Your receipt from X #r2' },
  { id: 'f3', date: '2026-01-25', merchant: 'Y', reference: null, amount: 50, currency: 'USD', status: 'ok' },     // excluded
  { id: 'f4', date: '2026-01-26', merchant: 'Z', reference: null, amount: null, currency: null, status: 'needs_parsing' },
  { id: 'f5', date: '2026-01-27', merchant: 'W', reference: 'r5', amount: 72, currency: 'ILS', status: 'ok' }
] };
L = app.computeLedger(sfeed, small, { ILS: 3.6 });
eq('rows', L.rows.length, 6);
eq('counted', L.counted.length, 3);                             // r1 (10), f2 (20), f5 (72 ILS = 20)
eq('total', L.total, 50);
eq('since-last rows', L.sinceRows.length, 1);
eq('since-last', L.sinceLast, 20);
eq('B paid', L.partners[0].paid, 10);
eq('B balance', L.partners[0].balance, 25 - 10 - 1);
eq('B carried', L.partners[0].carried, 14 - 10);
eq('excluded reason', L.rows.filter(function (r) { return r.id === 'f3'; })[0].reason, 'excluded');
eq('pending reason', L.rows.filter(function (r) { return r.id === 'f4'; })[0].reason, 'no_amount');
eq('dup description from history', L.rows.filter(function (r) { return r.id === 'f2'; })[0].description, 'dup');
eq('newest first', L.rows[0].id, 'f5');
L = app.computeLedger(sfeed, Object.assign({}, small, { settlements: [] }), { ILS: 3.6 });
eq('no payment → since-last = total', L.sinceLast, L.total);
eq('no payment → lastPayment null', L.lastPayment, null);
L = app.computeLedger(sfeed, Object.assign({}, small, { vendors: ['w'] }), { ILS: 3.6 });
eq('vendor list, case-insensitive', L.counted.length, 1);
L = app.computeLedger(null, small, { ILS: 3.6 });
eq('no feed: history alone', L.counted.length, 2);              // r1 and r2 (999)
var fixed = Object.assign({}, small, { settlements: [{ date: '2026-01-20', by: 'B', amount: 36, currency: 'ILS', ils_per_usd: 3.0 }] });
L = app.computeLedger(sfeed, fixed, { ILS: 3.6 });
eq('recorded rate wins over today\u2019s', L.partners[0].paid, 12);
eq('`by` is read as paid_by', L.partners[0].lastSettlement.paid_by, 'B');
fixed = Object.assign({}, small, { settlements: [{ date: '2026-01-20', by: 'B', amount: 36, currency: 'ILS', rate: 4.0 }] });
eq('`rate` is read too', app.computeLedger(sfeed, fixed, { ILS: 3.6 }).partners[0].paid, 9);
var series = { ILS: { latest: 3.0, byDate: { '2026-01-02': 4.0, '2026-01-26': 3.6, '2026-01-28': 3.0 } } };
L = app.computeLedger(sfeed, Object.assign({}, small, { settlements: [{ date: '2026-01-20', by: 'B', amount: 40, currency: 'ILS' }] }), series);
eq('receipt at the rate of its day (Jan 27 → Jan 26 quote)', L.rows.filter(function (r) { return r.id === 'f5'; })[0].value, 20);
eq('payment at the rate of its day (Jan 20 → Jan 2 quote)', L.partners[0].paid, 10);
eq('rateUsed for display', L.rateUsed({ currency: 'ILS', date: '2026-01-20' }), 4.0);
eq('date before the series → earliest quote', L.rateFor('ILS', '2025-12-01'), 4.0);
eq('date after the series → last quote', L.rateFor('ILS', '2027-01-01'), 3.0);
eq('recorded rate still wins', app.computeLedger(sfeed, Object.assign({}, small, { settlements: [{ date: '2026-01-20', by: 'B', amount: 40, currency: 'ILS', rate: 8 }] }), series).partners[0].paid, 5);
eq('earliest date', app.earliestDate(sfeed, small), '2026-01-01');
var n = app.normalizeAccounting({ display_currency: 'USD', history: [{ desc: 'x' }], settlements: [{ by: 'B', currency: 'USD', amount: 1, ils_per_usd: 3 }] });
eq('desc → description', n.history[0].description, 'x');
eq('ils_per_usd ignored for a USD payment', n.settlements[0].rate, undefined);

// ── 4. description scrubbing ──
console.log('descriptions');
eq('anthropic', app.scrubDescription({ subject: 'Your receipt from Anthropic, PBC #2055-4744-5590', merchant: 'Anthropic', merchant_raw: 'Anthropic, PBC', reference: '2055-4744-5590' }), '');
eq('green api', app.scrubDescription({ subject: 'Receipt green api MGS', merchant: 'Green API', reference: null }), 'MGS');
eq('order invoice', app.scrubDescription({ subject: 'Your order invoice (#44897717)', merchant: 'Green API', reference: '44897717' }), 'Your order invoice');
eq('supabase', app.scrubDescription({ subject: 'New invoice from Supabase Pte. Ltd. (#KBNTYE-00002)', merchant: 'Supabase', merchant_raw: 'Supabase Pte. Ltd.', reference: 'KBNTYE-00002' }), '');
eq('dangling preposition', app.scrubDescription({ subject: 'Confirm your email and launch your projects on Supabase!', merchant: 'Supabase', reference: null }), 'Confirm your email and launch your projects');
eq('merchant fragment only', app.scrubDescription({ subject: 'החשבונית שלך מ 019', merchant: '019 Mobile', merchant_raw: '019', reference: null }), '');
eq('render', app.scrubDescription({ subject: 'Your receipt from Render Services, Inc dba Render', merchant: 'Render', merchant_raw: 'Render Services, Inc dba Render', reference: '2567-4125' }), '');
eq('money', app.fmtMoney(1020.51, 'USD'), '$1,020.51');
eq('money whole', app.fmtMoney(465, 'ILS', { whole: true }), '₪465');
eq('money negative', app.fmtMoney(-3.5, 'USD'), '−$3.50');

console.log(checks + ' checks, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
