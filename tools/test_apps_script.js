#!/usr/bin/env node
/* Exercises apps-script/Code.gs under Node with stubbed Apps Script services and a
 * fake GitHub Contents API. Covers SPEC §6: PIN, validation, append, commit, 409 retry.
 *   node tools/test_apps_script.js
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var root = path.join(__dirname, '..');

var failures = 0, checks = 0;
function eq(name, got, want) {
  checks++;
  var ok = typeof want === 'number' ? Math.abs(got - want) < 0.005 : JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failures++; console.log('  FAIL ' + name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); }
}

// ── fake GitHub + Apps Script services ──
var projects = JSON.parse(fs.readFileSync(path.join(root, 'projects.json'), 'utf8'));
var accounting = JSON.parse(fs.readFileSync(path.join(root, 'local/mgs/accounting.json'), 'utf8'));
var store = {                                   // repo/path → { text, sha }
  'idododan/expense-split/projects.json': { text: JSON.stringify(projects), sha: 'sha-projects' },
  'idododan/mgs-expenses/data/accounting.json': { text: JSON.stringify(accounting), sha: 'sha-acc-1' }
};
var puts = [];
var conflictOnce = false;
var frankfurter = { ok: true, rate: 3.21 };
var b64 = function (s) { return Buffer.from(s, 'utf8').toString('base64'); };

var props = { GITHUB_TOKEN: 'tok', PIN_mgs: '1234', PIN_yourrights: '9999' };
var sandbox = {
  PropertiesService: { getScriptProperties: function () { return {
    getProperty: function (k) { return props[k] == null ? null : props[k]; },
    getProperties: function () { return props; }
  }; } },
  Utilities: {
    base64Decode: function (s) { return Buffer.from(s, 'base64'); },
    base64Encode: function (s) { return b64(s); },
    newBlob: function (bytes) { return { getDataAsString: function () { return Buffer.from(bytes).toString('utf8'); } }; },
    Charset: { UTF_8: 'UTF-8' }
  },
  ContentService: {
    MimeType: { JSON: 'json', JAVASCRIPT: 'js' },
    createTextOutput: function (t) { var o = { text: t, mime: null }; o.setMimeType = function (m) { o.mime = m; return o; }; return o; }
  },
  UrlFetchApp: { fetch: function (url, opts) {
    opts = opts || {};
    function resp(code, body) { return { getResponseCode: function () { return code; }, getContentText: function () { return body; } }; }
    var m;
    if ((m = url.match(/^https:\/\/api\.frankfurter\.app\/(\d{4}-\d{2}-\d{2})\?from=(\w+)&to=(\w+)$/))) {
      if (!frankfurter.ok) return resp(500, 'boom');
      var rates = {}; rates[m[3]] = frankfurter.rate;
      return resp(200, JSON.stringify({ date: m[1], rates: rates }));
    }
    if ((m = url.match(/^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/contents\/([^?]+)/))) {
      var key = m[1] + '/' + m[2];
      eq('auth header on ' + key, opts.headers && opts.headers.Authorization, 'Bearer tok');
      if ((opts.method || 'get').toLowerCase() === 'put') {
        var payload = JSON.parse(opts.payload);
        if (conflictOnce) { conflictOnce = false; return resp(409, '{"message":"sha mismatch"}'); }
        if (!store[key] || payload.sha !== store[key].sha) return resp(409, '{"message":"sha mismatch"}');
        var text = Buffer.from(payload.content, 'base64').toString('utf8');
        store[key] = { text: text, sha: 'sha-' + (puts.length + 2) };
        puts.push({ key: key, message: payload.message, branch: payload.branch, text: text });
        return resp(200, JSON.stringify({ commit: { sha: 'commit-' + puts.length } }));
      }
      if (!store[key]) return resp(404, '{"message":"Not Found"}');
      return resp(200, JSON.stringify({ content: b64(store[key].text).replace(/(.{60})/g, '$1\n'), sha: store[key].sha, encoding: 'base64' }));
    }
    return resp(500, 'unexpected url ' + url);
  } },
  Logger: { log: function () {} },
  Date: Date, JSON: JSON, Math: Math, Number: Number, String: String, Object: Object, Array: Array, RegExp: RegExp, Error: Error, isNaN: isNaN, encodeURIComponent: encodeURIComponent
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'apps-script/Code.gs'), 'utf8'), sandbox);
var post = function (body) { return JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(body) } }).text); };
var get = function (params) { return sandbox.doGet({ parameter: params }); };

// ── ping / errors ──
console.log('ping and errors');
eq('ping', JSON.parse(get({ action: 'ping', project: 'mgs' }).text), { ok: true, project: 'mgs' });
eq('ping jsonp', get({ action: 'ping', project: 'mgs', callback: 'cb1' }).text, 'cb1({"ok":true,"project":"mgs"});');
eq('ping jsonp mime', get({ action: 'ping', project: 'mgs', callback: 'cb1' }).mime, 'js');
eq('bad callback name ignored', get({ action: 'ping', project: 'mgs', callback: 'alert(1)' }).mime, 'json');
eq('unknown project', post({ action: 'ping', project: 'nope' }).error, 'unknown project "nope"');
eq('invalid project id', post({ action: 'ping', project: '../x' }).error, 'missing or invalid project');
eq('unknown action', post({ action: 'delete', project: 'mgs' }).error, 'unknown action');
eq('wrong pin', post({ action: 'add_payment', project: 'mgs', pin: '0000' }).error, 'wrong PIN');
eq('no pin', post({ action: 'add_payment', project: 'mgs' }).error, 'wrong PIN');
eq('body not json', JSON.parse(sandbox.doPost({ postData: { contents: '{nope' } }).text).error, 'body is not JSON');

// ── validation (with the right PIN) ──
console.log('validation');
var base = { action: 'add_payment', project: 'mgs', pin: '1234', date: '2026-11-08', paid_by: 'Guy', amount: 600, currency: 'ILS', note: 'Nov' };
eq('bad date', post(Object.assign({}, base, { date: '8/11/2026' })).error, 'date must be YYYY-MM-DD');
eq('future date', post(Object.assign({}, base, { date: '2031-01-01' })).error, 'date is in the future');
eq('before start', post(Object.assign({}, base, { date: '2026-01-01' })).error, 'date is before the accounting start 2026-06-07');
eq('zero amount', post(Object.assign({}, base, { amount: 0 })).error, 'amount must be a positive number');
eq('string amount ok', post(Object.assign({}, base, { amount: 'abc' })).error, 'amount must be a positive number');
eq('currency', post(Object.assign({}, base, { currency: 'EUR' })).error, 'currency must be one of USD, ILS');
eq('unknown partner', post(Object.assign({}, base, { paid_by: 'Omri' })).error, 'paid_by must be one of Ido, Guy');
eq('payer cannot pay himself', post(Object.assign({}, base, { paid_by: 'Ido' })).error, 'Ido pays the bills; a payment must come from another partner');
eq('nothing written so far', puts.length, 0);

// ── a successful payment ──
console.log('add payment');
var res = post(base);
eq('ok', res.ok, true);
eq('commit', res.commit, 'commit-1');
eq('one PUT', puts.length, 1);
eq('PUT target', puts[0].key, 'idododan/mgs-expenses/data/accounting.json');
eq('PUT branch', puts[0].branch, 'main');
eq('commit message', puts[0].message, 'payment: Guy ₪600 on 2026-11-08');
var written = JSON.parse(puts[0].text);
eq('settlements grew', written.settlements.length, accounting.settlements.length + 1);
var last = written.settlements[written.settlements.length - 1];
eq('id', last.id, 'p-2026-11-08-1');
eq('by', last.by, 'Guy');
eq('amount', last.amount, 600);
eq('currency', last.currency, 'ILS');
eq('note', last.note, 'Nov');
eq('rate recorded', last.rate, 3.21);
eq('added_by', last.added_by, 'web');
eq('added_at iso', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(last.added_at), true);
eq('old settlements untouched', written.settlements[0], accounting.settlements[0]);
eq('history untouched', written.history.length, accounting.history.length);
eq('migrated_from kept', written.migrated_from, accounting.migrated_from);
eq('response carries the file', res.accounting.settlements.length, written.settlements.length);
eq('file ends with newline', puts[0].text.slice(-1), '\n');

// ── second payment same day, USD (no rate), rate service down ──
console.log('second payment');
frankfurter.ok = false;
res = post(Object.assign({}, base, { amount: 50.5, currency: 'USD', note: '' }));
eq('ok', res.ok, true);
last = res.accounting.settlements[res.accounting.settlements.length - 1];
eq('id increments per day', last.id, 'p-2026-11-08-2');
eq('no rate for the display currency', last.rate, undefined);
eq('message', puts[1].message, 'payment: Guy $50.50 on 2026-11-08');
res = post(Object.assign({}, base, { amount: 100, currency: 'ILS', date: '2026-11-07' }));
eq('rate service down → no rate, still saved', res.ok && res.settlement.rate === undefined, true);
eq('sorted by date', res.accounting.settlements.map(function (s) { return s.date; }).join(','),
   '2026-06-18,2026-07-14,2026-08-13,2026-11-07,2026-11-08,2026-11-08');
frankfurter.ok = true;

// ── 409 once → re-read and retry ──
console.log('conflict retry');
conflictOnce = true;
var before = puts.length;
res = post(Object.assign({}, base, { amount: 1 }));
eq('ok after retry', res.ok, true);
eq('exactly one more write landed', puts.length, before + 1);

// ── JSONP add_payment ──
console.log('jsonp fallback');
var out = get(Object.assign({}, base, { amount: 2, callback: 'onPay' }));
eq('jsonp wrapper', out.text.slice(0, 11) + '…' + out.text.slice(-3), 'onPay({"ok"…});');

// ── missing files ──
console.log('missing files');
props.PIN_yourrights = '9999';
res = post(Object.assign({}, base, { project: 'yourrights', pin: '9999', paid_by: 'Omri' }));
eq('accounting missing', res.error, 'data/accounting.json not found in idododan/yourrights-expenses');
delete props.GITHUB_TOKEN;
eq('token missing', post(base).error, 'GITHUB_TOKEN is not set in Script Properties');

console.log(checks + ' checks, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
