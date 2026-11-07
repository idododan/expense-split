/**
 * Claude Spending — Gmail receipt fetcher (Google Apps Script web app)
 * ===================================================================
 * Runs under YOUR Google account, so it can read your Gmail. The
 * spending.html "Update" button calls this and renders whatever it returns.
 *
 * ── One-time setup ────────────────────────────────────────────────
 *  1. Go to https://script.google.com  →  New project.
 *  2. Delete the sample code, paste this whole file, and Save.
 *  3. Deploy ▸ New deployment ▸ type "Web app".
 *       - Execute as:        Me
 *       - Who has access:    Anyone
 *     Click Deploy and authorize the Gmail permission when prompted.
 *  4. Copy the "Web app" URL (looks like
 *       https://script.google.com/macros/s/AKfyc.../exec ).
 *  5. Paste it into APPS_SCRIPT_URL inside spending.html.
 *
 * The page calls this via JSONP (?callback=...) to avoid CORS issues.
 */

// Only receipts on/after this date are returned (matches spending.html).
var ACCOUNTING_START = '2026-06-07';

function doGet(e) {
  var callback = (e && e.parameter && e.parameter.callback) || 'callback';
  var receipts = fetchReceipts();
  var json = JSON.stringify(receipts);
  return ContentService
    .createTextOutput(callback + '(' + json + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function fetchReceipts() {
  // Only search mail from the accounting start onward — far fewer threads to
  // read than a blanket 2-year search, which keeps the response fast.
  var after = ACCOUNTING_START.replace(/-/g, '/'); // yyyy/MM/dd for Gmail
  var threads = GmailApp.search(
    'from:invoice+statements@mail.anthropic.com after:' + after);
  var byNumber = {}; // dedupe on receipt number

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      var body = msg.getPlainBody() || '';

      var amt = body.match(/PBC \$([0-9.]+) Paid ([A-Za-z]+ \d+, \d{4})/);
      if (!amt) return;

      var numMatch = body.match(/Receipt #([0-9-]+)/) ||
                     body.match(/Receipt number ([0-9-]+)/);
      var liMatch  = body.match(/Receipt #[0-9-]+\s+([\s\S]*?)\s+Qty/);

      var number = numMatch ? numMatch[1] : ('na-' + msg.getId());
      var paid   = new Date(amt[2]);
      var date   = Utilities.formatDate(paid,
                     Session.getScriptTimeZone(), 'yyyy-MM-dd');
      var desc   = liMatch ? liMatch[1].replace(/\s+/g, ' ').trim() : 'Anthropic charge';

      byNumber[number] = {
        date: date,
        amount: parseFloat(amt[1]),
        desc: desc,
        receipt: number
      };
    });
  });

  var list = Object.keys(byNumber).map(function (k) { return byNumber[k]; });
  list = list.filter(function (r) { return r.date >= ACCOUNTING_START; });
  list.sort(function (a, b) { return a.date < b.date ? 1 : -1; }); // newest first
  return list;
}
