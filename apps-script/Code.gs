/**
 * expense-split — payments web app (Google Apps Script)
 * =====================================================
 * The public page (GitHub Pages) cannot hold a GitHub token, so a payment entered on the
 * page is sent here. This script checks the project PIN, appends the payment to that
 * project's data/accounting.json through the GitHub Contents API, and returns the
 * updated file. One deployment serves every project. Contract: SPEC.md §6.
 *
 * ── One-time setup ──────────────────────────────────────────────────────────────
 *  1. In the Apps Script project "expense-split payments" (script.google.com, account
 *     idodan@gmail.com), Project Settings ▸ Script Properties must hold:
 *        GITHUB_TOKEN      fine-grained PAT, Contents read/write on the data repos only
 *        PIN_mgs           the MGS project PIN
 *        PIN_yourrights    the YourRights project PIN
 *     (one PIN_<project id> per project in projects.json)
 *  2. Replace the editor's Code.gs with this file. Save.
 *  3. Deploy ▸ New deployment ▸ type "Web app":
 *        Execute as:      Me
 *        Who has access:  Anyone
 *     Authorize the "connect to an external service" permission when prompted.
 *  4. Copy the Web app URL (https://script.google.com/macros/s/…/exec) into
 *     `payments_url` in projects.json of idododan/expense-split and commit.
 *  5. Check: open  <web app URL>?action=ping&project=mgs  → {"ok":true,"project":"mgs"}
 *
 * After editing this file: Deploy ▸ Manage deployments ▸ ✎ ▸ Version: New version ▸
 * Deploy. The URL stays the same.
 */

// Where projects.json lives: it maps a project id to its data repo and file paths.
var APP_REPO = 'idododan/expense-split';
var APP_BRANCH = 'main';
var PROJECTS_PATH = 'projects.json';

var GITHUB_API = 'https://api.github.com';
var ALLOWED_CURRENCIES = ['USD', 'ILS'];
var MAX_AMOUNT = 1000000;
var MAX_NOTE = 200;

// ───────────────────────────── entry points ─────────────────────────────

/** POST with a text/plain JSON body (the page's normal path). */
function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'body is not JSON' }); }
  return json_(handle_(body));
}

/** GET: ?action=ping, or the JSONP fallback ?action=add_payment&…&callback=fn. */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var result = handle_(p);
  if (p.callback && /^[\w.$]+$/.test(p.callback)) {
    return ContentService.createTextOutput(p.callback + '(' + JSON.stringify(result) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_(result);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ───────────────────────────── request handling ─────────────────────────────

function handle_(req) {
  try {
    var action = String(req.action || '');
    var project = String(req.project || '').toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,30}$/.test(project)) return { ok: false, error: 'missing or invalid project' };

    var props = PropertiesService.getScriptProperties();
    var pin = props.getProperty('PIN_' + project);
    if (!pin) return { ok: false, error: 'unknown project "' + project + '"' };

    if (action === 'ping') return { ok: true, project: project };
    if (action !== 'add_payment') return { ok: false, error: 'unknown action' };

    if (!req.pin || String(req.pin) !== pin) return { ok: false, error: 'wrong PIN' };

    var token = props.getProperty('GITHUB_TOKEN');
    if (!token) return { ok: false, error: 'GITHUB_TOKEN is not set in Script Properties' };

    var cfg = loadProjectConfig_(token, project);
    var acc = readFile_(token, cfg.repo, cfg.accounting_path, cfg.branch);
    if (!acc.json) return { ok: false, error: cfg.accounting_path + ' not found in ' + cfg.repo };

    var payment = validatePayment_(req, acc.json);
    if (payment.error) return { ok: false, error: payment.error };

    var updated = appendSettlement_(acc.json, payment);
    var message = 'payment: ' + payment.by + ' ' + symbol_(payment.currency) + trimNumber_(payment.amount) + ' on ' + payment.date;

    var commit;
    try {
      commit = writeFile_(token, cfg.repo, cfg.accounting_path, cfg.branch, updated, acc.sha, message);
    } catch (err) {
      if (String(err.message).indexOf('409') === -1) throw err;
      // someone else wrote the file meanwhile: re-read and append once more
      acc = readFile_(token, cfg.repo, cfg.accounting_path, cfg.branch);
      updated = appendSettlement_(acc.json, payment);
      commit = writeFile_(token, cfg.repo, cfg.accounting_path, cfg.branch, updated, acc.sha, message);
    }
    return { ok: true, project: project, commit: commit, settlement: payment, accounting: updated };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

function validatePayment_(req, acc) {
  var date = String(req.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + 'T00:00:00Z').getTime())) return { error: 'date must be YYYY-MM-DD' };
  var tomorrow = new Date(Date.now() + 36 * 3600 * 1000).toISOString().slice(0, 10);
  if (date > tomorrow) return { error: 'date is in the future' };
  if (acc.accounting_start && date < acc.accounting_start) return { error: 'date is before the accounting start ' + acc.accounting_start };

  var amount = Number(req.amount);
  if (!(amount > 0) || amount > MAX_AMOUNT) return { error: 'amount must be a positive number' };
  amount = Math.round(amount * 100) / 100;

  var currency = String(req.currency || '').toUpperCase();
  if (ALLOWED_CURRENCIES.indexOf(currency) === -1) return { error: 'currency must be one of ' + ALLOWED_CURRENCIES.join(', ') };

  var by = String(req.paid_by || req.by || '').trim();
  var partners = (acc.partners || []).map(function (p) { return p.name; });
  if (partners.indexOf(by) === -1) return { error: 'paid_by must be one of ' + partners.join(', ') };
  if (by === acc.paid_by) return { error: by + ' pays the bills; a payment must come from another partner' };

  var note = String(req.note || '').trim().slice(0, MAX_NOTE);

  var payment = { date: date, by: by, amount: amount, currency: currency, note: note };
  var base = acc.display_currency || 'USD';
  if (currency !== base) {
    var rate = rateOn_(date, base, currency);
    if (rate) payment.rate = rate;             // units of `currency` per 1 display unit that day
  }
  payment.added_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  payment.added_by = 'web';
  return payment;
}

function appendSettlement_(acc, payment) {
  var out = JSON.parse(JSON.stringify(acc));   // never mutate the parsed original (409 retry re-reads anyway)
  out.settlements = out.settlements || [];
  var n = out.settlements.filter(function (s) { return s.date === payment.date; }).length + 1;
  var row = { id: 'p-' + payment.date + '-' + n };
  Object.keys(payment).forEach(function (k) { row[k] = payment[k]; });
  out.settlements.push(row);
  out.settlements.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return out;
}

/** Frankfurter's rate for `date` (ECB reference; the latest available on weekends). */
function rateOn_(date, base, currency) {
  try {
    var r = UrlFetchApp.fetch('https://api.frankfurter.app/' + date + '?from=' + base + '&to=' + currency,
                              { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return null;
    var d = JSON.parse(r.getContentText());
    var v = d && d.rates && d.rates[currency];
    return typeof v === 'number' ? v : null;
  } catch (err) { return null; }
}

// ───────────────────────────── GitHub Contents API ─────────────────────────────

function ghHeaders_(token) {
  return {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

function loadProjectConfig_(token, project) {
  var f = readFile_(token, APP_REPO, PROJECTS_PATH, APP_BRANCH);
  if (!f.json) throw new Error(PROJECTS_PATH + ' not found in ' + APP_REPO);
  var cfg = f.json.projects && f.json.projects[project];
  if (!cfg) throw new Error('project "' + project + '" is not in ' + PROJECTS_PATH);
  if (!cfg.repo || !cfg.accounting_path) throw new Error('project "' + project + '" has no repo/accounting_path');
  cfg.branch = cfg.branch || 'main';
  return cfg;
}

/** → { json, sha } ; json is null when the file does not exist. */
function readFile_(token, repo, path, branch) {
  var url = GITHUB_API + '/repos/' + repo + '/contents/' + path + '?ref=' + encodeURIComponent(branch);
  var r = UrlFetchApp.fetch(url, { headers: ghHeaders_(token), muteHttpExceptions: true });
  var code = r.getResponseCode();
  if (code === 404) return { json: null, sha: null };
  if (code !== 200) throw new Error('GitHub read failed (' + code + ') for ' + repo + '/' + path + ': ' + r.getContentText().slice(0, 200));
  var meta = JSON.parse(r.getContentText());
  var text = Utilities.newBlob(Utilities.base64Decode(meta.content.replace(/\n/g, ''))).getDataAsString('UTF-8');
  return { json: JSON.parse(text), sha: meta.sha };
}

/** → commit sha */
function writeFile_(token, repo, path, branch, obj, sha, message) {
  var url = GITHUB_API + '/repos/' + repo + '/contents/' + path;
  var text = JSON.stringify(obj, null, 2) + '\n';
  var payload = { message: message, content: Utilities.base64Encode(text, Utilities.Charset.UTF_8), branch: branch };
  if (sha) payload.sha = sha;
  var r = UrlFetchApp.fetch(url, {
    method: 'put', contentType: 'application/json', headers: ghHeaders_(token),
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var code = r.getResponseCode();
  if (code !== 200 && code !== 201) throw new Error('GitHub write failed (' + code + '): ' + r.getContentText().slice(0, 200));
  var d = JSON.parse(r.getContentText());
  return d.commit && d.commit.sha;
}

// ───────────────────────────── helpers ─────────────────────────────

function symbol_(cur) { return { USD: '$', ILS: '₪', EUR: '€' }[cur] || (cur + ' '); }
function trimNumber_(n) { return Math.abs(n - Math.round(n)) < 0.005 ? String(Math.round(n)) : n.toFixed(2); }

/** Run from the editor to see the properties are in place (never prints their values). */
function checkSetup() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var keys = Object.keys(props).sort();
  Logger.log('properties set: ' + keys.join(', '));
  Logger.log('GITHUB_TOKEN ' + (props.GITHUB_TOKEN ? 'present' : 'MISSING'));
  keys.filter(function (k) { return k.indexOf('PIN_') === 0; }).forEach(function (k) { Logger.log(k + ' present'); });
  if (props.GITHUB_TOKEN) {
    var f = readFile_(props.GITHUB_TOKEN, APP_REPO, PROJECTS_PATH, APP_BRANCH);
    Logger.log(PROJECTS_PATH + ': ' + (f.json ? Object.keys(f.json.projects).join(', ') : 'NOT FOUND in ' + APP_REPO));
  }
}
