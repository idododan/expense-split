/**
 * expense-split — payment writer (Google Apps Script web app)
 * ===========================================================
 * One deployment for every project. The page calls it by JSONP:
 *   GET <exec URL>?action=add_payment&project=mgs&pin=…&date=2026-08-13
 *       &by=Guy&amount=465&currency=ILS&note=…&callback=fn
 * It checks the project's PIN, appends the payment to data/accounting.json in the
 * project's data repo through the GitHub Contents API, and answers
 *   fn({"ok":true,"commit":"<sha>"})   or   fn({"ok":false,"error":"…"})
 * Every write is a git commit, so nothing is lost silently.
 *
 * ── One-time setup ────────────────────────────────────────────────
 *  1. https://script.google.com → New project; paste this file; Save.
 *  2. Project Settings ▸ Script Properties — add:
 *       GITHUB_TOKEN   a fine-grained token: only the data repos
 *                      (idododan/mgs-expenses, idododan/yourrights-expenses),
 *                      permission "Contents: Read and write". Expires ≤ 1 year.
 *       REPO_mgs        idododan/mgs-expenses
 *       REPO_yourrights idododan/yourrights-expenses
 *       PIN_mgs, PIN_yourrights   the owner's PIN per project
 *     (optional BRANCH_<project>, default "main")
 *  3. Deploy ▸ New deployment ▸ Web app — Execute as: Me; Who has access: Anyone.
 *  4. Put the "/exec" URL in projects.json → apps_script_url.
 *  After editing this file: Deploy ▸ Manage deployments ▸ edit ▸ New version
 *  (keeps the same URL).
 *
 * The token and PINs never appear in the page or in any repo.
 */

var PATH = 'data/accounting.json';
var MAX_BAD_PINS = 8;            // per project, per hour; then the project is locked
var CURRENCIES = ['USD', 'ILS'];

function doGet(e) {
  var p = (e && e.parameter) || {};
  var callback = /^[A-Za-z_$][\w$]{0,63}$/.test(p.callback || '') ? p.callback : 'callback';
  var result;
  try {
    if (p.action !== 'add_payment') throw new Error('unknown action');
    result = addPayment(p);
  } catch (err) {
    result = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService
    .createTextOutput(callback + '(' + JSON.stringify(result) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function addPayment(p) {
  var props = PropertiesService.getScriptProperties();
  var project = String(p.project || '');
  if (!/^[a-z0-9-]{1,40}$/.test(project)) throw new Error('bad project');
  var repo = props.getProperty('REPO_' + project);
  var pin = props.getProperty('PIN_' + project);
  if (!repo || !pin) throw new Error('unknown project');
  checkPin(project, pin, String(p.pin || ''));

  var pay = {
    date: String(p.date || ''),
    by: String(p.by || ''),
    amount: Math.round(parseFloat(p.amount) * 100) / 100,
    currency: String(p.currency || '').toUpperCase(),
    note: String(p.note || '').slice(0, 200)
  };
  if (!/^\d{4}-\d\d-\d\d$/.test(pay.date) || isNaN(new Date(pay.date).getTime())) throw new Error('bad date');
  if (!(pay.amount > 0) || pay.amount > 1000000) throw new Error('bad amount');
  if (CURRENCIES.indexOf(pay.currency) === -1) throw new Error('currency must be USD or ILS');
  if (!pay.note) delete pay.note;

  var branch = props.getProperty('BRANCH_' + project) || 'main';
  var token = props.getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('GITHUB_TOKEN is not set');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('busy, try again');
  try {
    var file = readFile(repo, branch, token);
    var acc = JSON.parse(file.text);
    var partners = (acc.partners || []).map(function (x) { return x.name; });
    if (partners.indexOf(pay.by) === -1 || pay.by === acc.paid_by) {
      throw new Error('paid by must be one of: ' + partners.filter(function (n) { return n !== acc.paid_by; }).join(', '));
    }
    acc.settlements = acc.settlements || [];
    acc.settlements.push(pay);
    acc.settlements.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

    var sym = pay.currency === 'ILS' ? '₪' : '$';
    var message = 'payment: ' + pay.by + ' ' + sym + formatAmount(pay.amount) + ' on ' + pay.date;
    var sha = writeFile(repo, branch, token, JSON.stringify(acc, null, 2) + '\n', file.sha, message);
    return { ok: true, commit: sha, message: message };
  } finally {
    lock.releaseLock();
  }
}

function checkPin(project, expected, given) {
  var cache = CacheService.getScriptCache();
  var key = 'badpin_' + project;
  var bad = parseInt(cache.get(key) || '0', 10);
  if (bad >= MAX_BAD_PINS) throw new Error('too many wrong PINs, try again in an hour');
  if (given !== expected) {
    cache.put(key, String(bad + 1), 3600);
    throw new Error('wrong PIN');
  }
}

function formatAmount(n) {
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

function api(url, token, options) {
  options = options || {};
  options.headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  options.muteHttpExceptions = true;
  var res = UrlFetchApp.fetch(url, options);
  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code < 200 || code >= 300) throw new Error('GitHub ' + code + ': ' + body.slice(0, 200));
  return JSON.parse(body);
}

function contentsUrl(repo) {
  return 'https://api.github.com/repos/' + repo + '/contents/' + PATH;
}

function readFile(repo, branch, token) {
  var d = api(contentsUrl(repo) + '?ref=' + encodeURIComponent(branch), token);
  var bytes = Utilities.base64Decode(String(d.content).replace(/\s/g, ''));
  return { sha: d.sha, text: Utilities.newBlob(bytes).getDataAsString('UTF-8') };
}

function writeFile(repo, branch, token, text, sha, message) {
  var d = api(contentsUrl(repo), token, {
    method: 'put',
    contentType: 'application/json',
    payload: JSON.stringify({
      message: message,
      content: Utilities.base64Encode(text, Utilities.Charset.UTF_8),
      sha: sha,
      branch: branch
    })
  });
  return d.commit && d.commit.sha;
}
