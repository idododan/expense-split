/* expense-split — one page, one project at a time, who owes whom.
 * SPEC.md is the contract. The balance rule (§4) is computeLedger(), a pure function
 * that tools/test_ledger.js also runs under Node. Everything else is fetching and DOM.
 */
(function (global) {
  'use strict';

  var SYMBOLS = { USD: '$', ILS: '₪', EUR: '€', GBP: '£' };
  // Last-known rates, used only when both rate services fail (shown as "offline rate").
  var FALLBACK_RATES = { USD: { ILS: 3.0129, EUR: 0.86, GBP: 0.75 } };
  var FEED_BOILERPLATE = [
    /^your receipt from\s+/i, /^new invoice from\s+/i, /^your invoice from\s+/i,
    /^receipt from\s+/i, /^receipt\s+/i, /^invoice\s+/i, /^electronic receipt$/i,
    /^החשבונית שלך מ\s*/, /^קבלה\s*/, /^חשבונית\s*/
  ];

  // ───────────────────────────── helpers ─────────────────────────────

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function round2(n) { return Math.round(n * 100) / 100; }

  function fmtMoney(n, cur, opts) {
    opts = opts || {};
    var sym = SYMBOLS[cur] || (cur + ' ');
    var abs = Math.abs(n);
    var digits = opts.whole && Math.abs(abs - Math.round(abs)) < 0.005 ? 0 : 2;
    var s = abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return (n < 0 ? '−' : '') + sym + s;
  }
  function fmtDate(iso, withYear) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    var o = { month: 'short', day: 'numeric' };
    if (withYear) o.year = 'numeric';
    return d.toLocaleDateString('en-US', o);
  }
  function fmtPct(share) {
    var p = share * 100;
    return (Math.abs(p - Math.round(p)) < 0.01 ? Math.round(p) : p.toFixed(1)) + '';
  }
  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /** The feed subject minus the vendor boilerplate, the merchant name and the reference. */
  function scrubDescription(row) {
    var s = row.subject || '';
    FEED_BOILERPLATE.forEach(function (re) { s = s.replace(re, ''); });
    [row.merchant_raw, row.merchant].forEach(function (name) {
      if (name) s = s.replace(new RegExp(escRe(name), 'ig'), '');
    });
    if (row.reference) {
      s = s.replace(new RegExp('\\(?#?\\s*' + escRe(String(row.reference)) + '\\)?', 'g'), '');
    }
    s = s.replace(/^[\s,.:;#\-–—()!]+|[\s,.:;#\-–—()!]+$/g, '').replace(/\s{2,}/g, ' ');
    s = s.replace(/\s+(on|to|from|at|for|with|by|של|מ)$/i, '');          // dangling preposition
    var m = String(row.merchant || '').toLowerCase();
    if (s && m.indexOf(s.toLowerCase()) !== -1) s = '';                     // just the merchant again
    return s;
  }

  // ───────────────────────────── the balance rule (SPEC §4) ─────────────────────────────

  /** Accept the field spellings in the live files (desc / by / ils_per_usd) and the spec's. */
  function normalizeAccounting(acc) {
    var base = acc.display_currency || 'USD';
    var out = Object.assign({}, acc);
    out.history = (acc.history || []).map(function (h) {
      return Object.assign({}, h, { description: h.description || h.desc || '' });
    });
    function withRate(x) {
      var y = Object.assign({}, x, { paid_by: x.paid_by || x.by });
      if (y.rate == null && typeof x.ils_per_usd === 'number' && x.currency === 'ILS' && base === 'USD') y.rate = x.ils_per_usd;
      return y;
    }
    out.settlements = (acc.settlements || []).map(withRate);
    out.adjustments = (acc.adjustments || []).map(withRate);
    return out;
  }

  /**
   * computeLedger(feed, accounting, rates) → ledger
   *   feed       the project's expenses.json ({expenses:[…]}) or null
   *   accounting the project's accounting.json
   *   rates      {CUR: r} where r is a number (units of CUR per 1 display-currency unit)
   *              or { latest: number, byDate: {'YYYY-MM-DD': number} } — then each row,
   *              payment and adjustment converts at the rate of its own date (SPEC §5)
   * Pure: no DOM, no network, no Date.now().
   */
  function computeLedger(feed, rawAcc, rates) {
    var acc = normalizeAccounting(rawAcc);
    var base = acc.display_currency || 'USD';
    var start = acc.accounting_start;
    var vendors = acc.vendors == null ? '*' : acc.vendors;
    var vendorSet = null;
    if (vendors !== '*') {
      vendorSet = {};
      vendors.forEach(function (v) { vendorSet[String(v).toLowerCase()] = true; });
    }
    var excluded = {};
    (acc.excluded || []).forEach(function (id) { excluded[id] = true; });
    var shares = {};
    (acc.partners || []).forEach(function (p) { shares[p.name] = p.share; });
    var paidBy = acc.paid_by;

    function rateFor(cur, date) {
      cur = cur || base;
      if (cur === base) return 1;
      var r = rates && rates[cur];
      if (typeof r === 'number') return r;
      if (!r || (!r.byDate && !r.latest)) throw new Error('no rate for ' + cur);
      var best = null;
      if (r.byDate && date) {                                    // the latest quote on or before that day
        Object.keys(r.byDate).forEach(function (d) { if (d <= date && (!best || d > best)) best = d; });
        if (!best) { Object.keys(r.byDate).forEach(function (d) { if (!best || d < best) best = d; }); }
      }
      if (best) return r.byDate[best];
      if (r.latest) return r.latest;
      throw new Error('no rate for ' + cur);
    }
    function value(amount, cur, date) { return amount / rateFor(cur, date); }
    /** A settlement or adjustment: its own recorded rate wins; else the rate of its date. */
    function valueOf(x) { return x.rate && x.currency !== base ? x.amount / x.rate : value(x.amount, x.currency, x.date); }
    function rateUsed(x) { return x.currency === base ? 1 : (x.rate || rateFor(x.currency, x.date)); }

    // rows = feed ∪ history, deduplicated by reference (feed wins; history description shown)
    var rows = [];
    var byRef = {};
    (feed && feed.expenses || []).forEach(function (r) {
      var row = {
        id: r.id, date: r.date, merchant: r.merchant || '?', merchant_raw: r.merchant_raw,
        reference: r.reference || null, amount: typeof r.amount === 'number' ? r.amount : null,
        currency: r.currency || (typeof r.amount === 'number' ? base : null),
        status: r.status, shared: !!r.shared, receipt_total: r.receipt_total == null ? null : r.receipt_total,
        subject: r.subject, source: 'feed'
      };
      row.description = scrubDescription(r);
      rows.push(row);
      if (row.reference) byRef[row.reference] = row;
    });
    (acc.history || []).forEach(function (h) {
      var match = h.reference && byRef[h.reference];
      if (match) {
        if (h.description) match.description = h.description;
        match.history_amount = h.amount;
        return;
      }
      rows.push({
        id: 'hist:' + (h.reference || (h.date + ':' + h.amount)), date: h.date, merchant: h.merchant || '?',
        reference: h.reference || null, amount: typeof h.amount === 'number' ? h.amount : null,
        currency: h.currency || base, status: 'ok', shared: false, receipt_total: null,
        description: h.description || '', source: 'history'
      });
    });

    rows.forEach(function (row) {
      var reason = null;
      if (row.date < start) reason = 'before_start';
      else if (vendorSet && !vendorSet[String(row.merchant).toLowerCase()]) reason = 'vendor';
      else if (excluded[row.id]) reason = 'excluded';
      else if (row.amount == null) reason = 'no_amount';
      row.counted = reason === null;
      row.reason = reason;
      row.value = row.amount == null ? null : value(row.amount, row.currency, row.date);
    });
    rows.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;      // newest first
      return (a.merchant + a.id) < (b.merchant + b.id) ? -1 : 1;
    });

    var counted = rows.filter(function (r) { return r.counted; });
    var total = counted.reduce(function (s, r) { return s + r.value; }, 0);

    var settlements = (acc.settlements || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var lastPayment = null;
    settlements.forEach(function (s) {
      if (s.paid_by !== paidBy && (!lastPayment || s.date > lastPayment)) lastPayment = s.date;
    });
    var sinceRows = counted.filter(function (r) { return !lastPayment || r.date > lastPayment; });
    var sinceLast = sinceRows.reduce(function (s, r) { return s + r.value; }, 0);

    var partners = (acc.partners || []).filter(function (p) { return p.name !== paidBy; }).map(function (p) {
      var paid = 0, adjusted = 0, last = null;
      settlements.forEach(function (s) {
        if (s.paid_by === p.name) { paid += valueOf(s); last = s; }
      });
      (acc.adjustments || []).forEach(function (a) {
        if (a.partner === p.name) adjusted += valueOf(a);
      });
      var shareAmount = total * p.share;
      var balance = shareAmount - paid + adjusted;
      return {
        name: p.name, share: p.share, shareAmount: shareAmount, paid: paid, adjusted: adjusted,
        balance: balance, carried: balance - sinceLast * p.share, lastSettlement: last
      };
    });

    var recent = rows.filter(function (r) { return !lastPayment || r.date > lastPayment; });
    var earlier = rows.filter(function (r) { return lastPayment && r.date <= lastPayment; });

    return {
      base: base, start: start, paidBy: paidBy, vendors: vendors, rows: rows, counted: counted,
      total: total, sinceRows: sinceRows, sinceLast: sinceLast, lastPayment: lastPayment,
      partners: partners, settlements: settlements, recent: recent, earlier: earlier,
      pending: rows.filter(function (r) { return r.reason === 'no_amount'; }).length,
      value: value, valueOf: valueOf, rateFor: rateFor, rateUsed: rateUsed
    };
  }

  // ───────────────────────────── rates ─────────────────────────────

  function neededCurrencies(feed, acc) {
    var base = acc.display_currency || 'USD';
    var set = {};
    (feed && feed.expenses || []).forEach(function (r) { if (r.currency) set[r.currency] = true; });
    (acc.history || []).forEach(function (h) { if (h.currency) set[h.currency] = true; });
    (acc.settlements || []).forEach(function (s) { if (s.currency) set[s.currency] = true; });
    (acc.adjustments || []).forEach(function (a) { if (a.currency) set[a.currency] = true; });
    set.ILS = true; set.USD = true;                       // the payment form offers both
    delete set[base];
    return Object.keys(set).sort();
  }

  function fallbackRates(base, currencies) {
    var out = {};
    currencies.forEach(function (c) {
      var r = FALLBACK_RATES[base] && FALLBACK_RATES[base][c];
      if (!r && FALLBACK_RATES[c] && FALLBACK_RATES[c][base]) r = 1 / FALLBACK_RATES[c][base];
      out[c] = r || 1;
    });
    return out;
  }

  function earliestDate(feed, acc) {
    var dates = [acc.accounting_start];
    (feed && feed.expenses || []).forEach(function (r) { if (r.date) dates.push(r.date); });
    (acc.history || []).forEach(function (h) { if (h.date) dates.push(h.date); });
    (acc.settlements || []).forEach(function (x) { if (x.date) dates.push(x.date); });
    (acc.adjustments || []).forEach(function (x) { if (x.date) dates.push(x.date); });
    return dates.filter(Boolean).sort()[0];
  }

  /** Daily ECB rates since `since` (Frankfurter), else today's flat rate (two services), else the offline table. */
  function fetchRates(base, currencies, since) {
    if (!currencies.length) return Promise.resolve({ rates: {}, live: true, source: 'none', date: null, daily: false });
    var to = currencies.join(',');
    return fetch('https://api.frankfurter.app/' + since + '..?from=' + base + '&to=' + to)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.rates || !d.end_date) throw new Error('no series');
        var out = {};
        currencies.forEach(function (c) {
          var byDate = {};
          Object.keys(d.rates).forEach(function (day) { if (d.rates[day][c]) byDate[day] = d.rates[day][c]; });
          if (!Object.keys(byDate).length) throw new Error('no rate ' + c);
          out[c] = { latest: d.rates[d.end_date] && d.rates[d.end_date][c] || byDate[Object.keys(byDate).sort().pop()], byDate: byDate };
        });
        return { rates: out, live: true, source: 'Frankfurter', date: d.end_date, daily: true };
      })
      .catch(function () {
        return fetch('https://api.frankfurter.app/latest?from=' + base + '&to=' + to)
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d || !d.rates) throw new Error('no rates');
            currencies.forEach(function (c) { if (!d.rates[c]) throw new Error('no rate ' + c); });
            return { rates: d.rates, live: true, source: 'Frankfurter', date: d.date, daily: false };
          });
      })
      .catch(function () {
        return fetch('https://open.er-api.com/v6/latest/' + base)
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d || !d.rates) throw new Error('no rates');
            var out = {};
            currencies.forEach(function (c) { if (!d.rates[c]) throw new Error('no rate ' + c); out[c] = d.rates[c]; });
            return { rates: out, live: true, source: 'open.er-api', date: (d.time_last_update_utc || '').slice(5, 16), daily: false };
          });
      })
      .catch(function () {
        return { rates: fallbackRates(base, currencies), live: false, source: 'offline', date: null, daily: false };
      });
  }

  // ───────────────────────────── data loading ─────────────────────────────

  function ghFetchJson(repo, path, branch) {
    var url = 'https://api.github.com/repos/' + repo + '/contents/' + path + '?ref=' + encodeURIComponent(branch || 'main');
    return fetch(url, { headers: { Accept: 'application/vnd.github.raw+json' }, cache: 'no-store' })
      .then(function (r) {
        if (r.status === 404) return null;
        if (r.status === 403) throw new Error('GitHub API limit reached (60 requests/hour). Try again in a few minutes.');
        if (!r.ok) throw new Error('GitHub answered ' + r.status + ' for ' + repo + '/' + path);
        return r.text();
      })
      .then(function (t) {
        if (t === null) return null;
        var d = JSON.parse(t);
        if (d && d.encoding === 'base64' && typeof d.content === 'string') {   // metadata answer, not raw
          var bin = atob(d.content.replace(/\n/g, ''));
          var bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          d = JSON.parse(new TextDecoder('utf-8').decode(bytes));
        }
        return d;
      });
  }

  function localFetchJson(path) {
    return fetch(path, { cache: 'no-store' }).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('could not read ' + path + ' (' + r.status + ')');
      return r.json();
    });
  }

  function loadProject(cfg, source) {
    if (source === 'local') {
      return Promise.all([
        localFetchJson(cfg.local + '/expenses.json'),
        localFetchJson(cfg.local + '/accounting.json')
      ]);
    }
    return Promise.all([
      ghFetchJson(cfg.repo, cfg.expenses_path, cfg.branch),
      ghFetchJson(cfg.repo, cfg.accounting_path, cfg.branch)
    ]);
  }

  // ───────────────────────────── rendering ─────────────────────────────

  var state = { config: null, projectId: null, cfg: null, source: 'github', feed: null, acc: null,
                fx: { rates: {}, live: false, source: 'offline', date: null }, ledger: null, payFormOpen: false };

  function $(id) { return document.getElementById(id); }

  function rowHtml(r, ledger) {
    var base = ledger.base;
    var cls = 'receipt' + (r.counted ? '' : ' uncounted') + (r.reason === 'excluded' ? ' strike' : '');
    var primary = r.amount == null ? 'amount pending' : fmtMoney(r.amount, r.currency);
    var conv = '';
    if (r.amount != null && r.currency !== base) conv = ' <span class="conv">(' + fmtMoney(r.value, base) + ')</span>';
    var half = '';
    if (r.counted) {
      half = ledger.partners.map(function (p) {
        var label = Math.abs(p.share - 0.5) < 1e-9 ? 'half' : p.name + "'s " + fmtPct(p.share) + '%';
        return label + ': ' + fmtMoney(r.value * p.share, base);
      }).join(' · ');
    } else {
      half = { before_start: 'before ' + fmtDate(ledger.start) + ' · not split', vendor: 'not a shared vendor',
               excluded: 'excluded', no_amount: 'not counted until parsed' }[r.reason] || '';
    }
    var meta = [fmtDate(r.date, true)];
    if (r.reference) meta.push('#' + r.reference);
    if (r.shared) meta.push(r.receipt_total != null ? 'this project’s part of ' + fmtMoney(r.receipt_total, r.currency) : 'also in another project');
    if (r.source === 'history') meta.push('from the old page');
    var title = esc(r.merchant) + (r.description ? ' <span class="sep">·</span> ' + esc(r.description) : '');
    return '<div class="' + cls + '">' +
      '<div class="icon">🧾</div>' +
      '<div class="info"><div class="desc">' + title + '</div><div class="meta">' + esc(meta.join(' · ')) + '</div></div>' +
      '<div class="money"><div class="amount">' + esc(primary) + conv + '</div><div class="half">' + esc(half) + '</div></div>' +
      '</div>';
  }

  function render() {
    var cfg = state.cfg, acc = state.acc, feed = state.feed;
    var content = $('content');
    var savedForm = state.payFormOpen ? readPayForm() : null;   // survive the re-render when live rates arrive
    $('eyebrow').textContent = 'Shared expenses 💸';
    $('title').textContent = cfg.name;

    if (!acc) {
      $('subtitle').textContent = 'no accounting file yet';
      content.innerHTML = '<div class="summary notice">This project has receipts but no <code>' + esc(cfg.accounting_path) +
        '</code> yet, so there is no balance to show.' + (feed ? ' The feed has ' + feed.expenses.length + ' rows.' : '') + '</div>';
      $('footer-text').textContent = '';
      return;
    }

    var ledger;
    try { ledger = computeLedger(feed, acc, state.fx.rates); }
    catch (e) { content.innerHTML = '<div class="summary notice">' + esc(e.message) + '</div>'; return; }
    state.ledger = ledger;
    var base = ledger.base;
    var others = ledger.partners;

    var names = (acc.partners || []).map(function (p) { return p.name; }).join(' & ');
    var split = (acc.partners || []).map(function (p) { return fmtPct(p.share); }).join('/');
    $('subtitle').textContent = names + ' ' + split + ' · since ' + fmtDate(ledger.start, true) +
      (ledger.vendors !== '*' ? ' · ' + ledger.vendors.join(', ') + ' only' : '');

    // ── summary card (mockup A) ──
    var h = '<div class="summary">';
    h += '<div class="total-row"><div class="total-label">To split since ' +
      (ledger.lastPayment ? 'last payment (' + esc(fmtDate(ledger.lastPayment)) + ')' : esc(fmtDate(ledger.start, true))) +
      '</div><div class="total-amount">' + esc(fmtMoney(ledger.sinceLast, base)) + '</div>' +
      (ledger.pending ? '<div class="pending">+ ' + ledger.pending + ' receipt' + (ledger.pending > 1 ? 's' : '') + ' with the amount still pending</div>' : '') +
      '</div>';
    h += '<div class="divider"></div>';
    others.forEach(function (p) {
      var owes = p.balance;
      var label, amount;
      if (Math.abs(owes) < 0.005) { label = 'All settled up 🎉'; amount = fmtMoney(0, base); }
      else if (owes > 0) { label = esc(p.name) + ' owes ' + esc(ledger.paidBy); amount = fmtMoney(owes, base); }
      else { label = esc(ledger.paidBy) + ' owes ' + esc(p.name); amount = fmtMoney(-owes, base); }
      h += '<div class="balance-row"><div class="balance-label">' + label + '</div><div class="balance-amount">' + esc(amount) + '</div>';
      if (Math.abs(p.carried) >= 0.005) {
        h += '<div class="carried">incl. ' + esc(fmtMoney(Math.abs(p.carried), base)) + (p.carried > 0 ? ' carried over from before' : ' overpaid before') +
          (Math.abs(p.adjusted) >= 0.005 ? ' (with ' + esc(fmtMoney(p.adjusted, base)) + ' adjustments)' : '') + '</div>';
      }
      h += '</div>';
      if (p.lastSettlement) {
        var s = p.lastSettlement;
        var paidStr = fmtMoney(s.amount, s.currency, { whole: true });
        if (s.currency !== base) paidStr += ' (~' + fmtMoney(ledger.valueOf(s), base) + ', at ' + fmtMoney(ledger.rateUsed(s), s.currency) + ' then)';
        h += '<div class="settle-note">✅ ' + esc(p.name) + ' paid ' + esc(paidStr) + ' on ' + esc(fmtDate(s.date, true)) +
          (s.note ? ' · ' + esc(s.note) : '') + '</div>';
      }
    });
    var fxLine = rateLine(ledger);
    if (fxLine) h += '<div class="fx">' + esc(fxLine) + '</div>';
    h += '<button class="add-btn" id="add-btn" type="button">+ Add payment</button>';
    h += '<div id="pay-form-slot"></div>';
    h += '</div>';

    // ── receipts ──
    var sinceLabel = ledger.lastPayment ? 'Receipts since ' + fmtDate(ledger.lastPayment) : 'Receipts';
    h += '<div class="section-title">' + esc(sinceLabel) + ' (' + ledger.sinceRows.length + ')</div>';
    h += ledger.recent.length ? ledger.recent.map(function (r) { return rowHtml(r, ledger); }).join('')
                               : '<div class="empty">Nothing since then.</div>';
    if (ledger.earlier.length) {
      var earlierCounted = ledger.earlier.filter(function (r) { return r.counted; }).length;
      h += '<details class="earlier"><summary class="section-title">Earlier receipts (settled) · ' + earlierCounted +
        (ledger.earlier.length > earlierCounted ? ' + ' + (ledger.earlier.length - earlierCounted) + ' not counted' : '') + '</summary>';
      h += ledger.earlier.map(function (r) { return rowHtml(r, ledger); }).join('');
      h += '</details>';
    }
    content.innerHTML = h;

    // ── footer ──
    var paidAll = others.map(function (p) { return p.name + ' paid ' + fmtMoney(p.paid, base); }).join(' · ');
    var gen = feed && feed.generated_at ? ' · feed ' + feed.generated_at.replace('T', ' ').replace(/:\d\dZ$/, '') : '';
    $('footer-text').textContent = 'Since ' + fmtDate(ledger.start) + ': ' + fmtMoney(ledger.total, base) + ' spent · ' +
      paidAll + ' · ' + ledger.counted.length + ' receipts' + gen + (state.source === 'local' ? ' · local data' : '');

    $('add-btn').onclick = togglePayForm;
    if (state.payFormOpen) openPayForm(savedForm);
  }

  function rateLine(ledger) {
    var fx = state.fx, base = ledger.base;
    var keys = Object.keys(fx.rates || {}).filter(function (c) { return c !== base; });
    if (!keys.length) return '';
    var parts = keys.map(function (c) {
      var r = fx.rates[c]; var latest = typeof r === 'number' ? r : r.latest;
      return '1 ' + base + ' = ' + fmtMoney(latest, c);
    });
    var tail = fx.daily ? ' · each receipt and payment at the ECB rate of its own day'
             : fx.live ? ' · today\u2019s rate for every date' : ' · offline rate for every date';
    return (fx.date ? 'latest ' : '') + parts.join(' · ') + (fx.date ? ' (' + fx.date + ')' : '') + tail;
  }

  // ───────────────────────────── payments (SPEC §6) ─────────────────────────────

  function pinKey() { return 'expense-split.pin.' + state.projectId; }

  function readPayForm() {
    var f = $('pay-form');
    if (!f) return null;
    return { date: f.date.value, paid_by: f.paid_by.value, amount: f.amount.value, currency: f.currency.value,
             note: f.note.value, pin: f.pin.value, status: $('pay-status').textContent };
  }

  function closePayForm() { state.payFormOpen = false; var slot = $('pay-form-slot'); if (slot) slot.innerHTML = ''; }
  function togglePayForm() { if (state.payFormOpen) closePayForm(); else openPayForm(null); }

  function openPayForm(saved) {
    var slot = $('pay-form-slot');
    state.payFormOpen = true;
    var ledger = state.ledger;
    var others = ledger.partners;
    var pin = '';
    try { pin = localStorage.getItem(pinKey()) || ''; } catch (e) { /* private mode */ }
    saved = saved || {};
    var h = '<form class="pay-form" id="pay-form">';
    h += '<label>Date <input type="date" name="date" value="' + esc(saved.date || todayIso()) + '" required></label>';
    h += '<label>Paid by <select name="paid_by">' + others.map(function (p) {
      return '<option' + (saved.paid_by === p.name ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></label>';
    h += '<label>Amount <input type="number" name="amount" step="0.01" min="0.01" inputmode="decimal" value="' + esc(saved.amount || '') + '" required></label>';
    var cur = saved.currency || ledger.base;
    h += '<label>Currency <select name="currency"><option' + (cur === 'ILS' ? ' selected' : '') + '>ILS</option><option' + (cur === 'USD' ? ' selected' : '') + '>USD</option></select></label>';
    h += '<label class="wide">Note <input type="text" name="note" maxlength="200" placeholder="optional" value="' + esc(saved.note || '') + '"></label>';
    h += '<label>Project PIN <input type="password" name="pin" autocomplete="off" value="' + esc(saved.pin != null ? saved.pin : pin) + '" required></label>';
    h += '<div class="actions"><button type="submit" class="primary">Save payment</button><button type="button" id="pay-cancel">Cancel</button></div>';
    h += '<div class="pay-status" id="pay-status">' + esc(saved.status || '') + '</div>';
    h += '</form>';
    slot.innerHTML = h;
    $('pay-cancel').onclick = closePayForm;
    $('pay-form').onsubmit = submitPayment;
    if (!saved.amount) slot.querySelector('[name=amount]').focus();
  }

  function submitPayment(ev) {
    ev.preventDefault();
    var form = ev.target;
    var status = $('pay-status');
    var url = state.config.payments_url;
    if (!url) { status.textContent = 'payments_url is not set in projects.json — deploy the Apps Script first.'; return; }
    var payload = {
      action: 'add_payment', project: state.projectId, pin: form.pin.value.trim(),
      date: form.date.value, paid_by: form.paid_by.value, amount: parseFloat(form.amount.value),
      currency: form.currency.value, note: form.note.value.trim()
    };
    if (!(payload.amount > 0)) { status.textContent = 'Amount must be positive.'; return; }
    var btn = form.querySelector('button[type=submit]');
    btn.disabled = true; status.textContent = 'Saving…';
    fetch(url, { method: 'POST', body: JSON.stringify(payload),
                 headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || !res.ok) throw new Error(res && res.error ? res.error : 'unexpected answer from the payments script');
        try { localStorage.setItem(pinKey(), payload.pin); } catch (e) { /* ignore */ }
        if (res.accounting) state.acc = res.accounting;
        closePayForm();
        render();
        showToast('Payment saved ✅' + (res.commit ? ' · commit ' + res.commit.slice(0, 7) : ''));
      })
      .catch(function (e) {
        btn.disabled = false;
        status.textContent = '❌ ' + e.message;
      });
  }

  // ───────────────────────────── toast, refresh, boot ─────────────────────────────

  var toastTimer;
  function showToast(msg) {
    var t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3800);
  }

  function fail(msg) {
    $('content').innerHTML = '<div class="summary notice">' + esc(msg) + '</div>';
    $('footer-text').textContent = '';
  }

  function renderChooser() {
    $('eyebrow').textContent = 'Shared expenses 💸';
    $('title').textContent = 'Expense split';
    $('subtitle').textContent = 'pick a project';
    var ids = Object.keys(state.config.projects);
    $('content').innerHTML = '<div class="summary"><div class="chooser">' + ids.map(function (id) {
      var p = state.config.projects[id];
      return '<a class="project-link" href="?project=' + encodeURIComponent(id) + (state.source === 'local' ? '&source=local' : '') + '">' +
        esc(p.name) + '<span class="meta">?project=' + esc(id) + '</span></a>';
    }).join('') + '</div></div>';
    $('footer-text').textContent = '';
  }

  function loadAndRender() {
    var cfg = state.cfg;
    $('refresh-btn').disabled = true;
    return loadProject(cfg, state.source)
      .then(function (res) {
        state.feed = res[0]; state.acc = res[1];
        if (!state.feed && !state.acc) throw new Error('Neither ' + cfg.expenses_path + ' nor ' + cfg.accounting_path + ' was found in ' + (state.source === 'local' ? cfg.local : cfg.repo) + '.');
        if (!state.feed) state.feed = { expenses: [] };
        if (state.acc) {
          var need = neededCurrencies(state.feed, state.acc);
          state.fx = { rates: fallbackRates(state.acc.display_currency || 'USD', need), live: false, source: 'offline', date: null };
          render();                                             // paint at once with the fallback rate
          return fetchRates(state.acc.display_currency || 'USD', need, earliestDate(state.feed, state.acc))
            .then(function (fx) { state.fx = fx; render(); });
        }
        render();
      })
      .catch(function (e) { fail(e.message); })
      .then(function () { $('refresh-btn').disabled = false; });
  }

  function boot() {
    var params = new URLSearchParams(location.search);
    state.projectId = params.get('project');
    state.source = params.get('source') === 'local' ? 'local' : 'github';
    state.payFormOpen = location.hash === '#pay';                 // deep link straight to the form
    $('refresh-btn').onclick = function () { loadAndRender().then(function () { showToast('Refreshed'); }); };
    localFetchJson('projects.json')
      .then(function (config) {
        if (!config) throw new Error('projects.json not found');
        state.config = config;
        if (!state.projectId) { renderChooser(); return; }
        state.cfg = config.projects[state.projectId];
        if (!state.cfg) throw new Error('Unknown project "' + state.projectId + '". Known: ' + Object.keys(config.projects).join(', '));
        document.title = state.cfg.name + ' — expense split';
        return loadAndRender();
      })
      .catch(function (e) { fail(e.message); });
  }

  var api = { computeLedger: computeLedger, normalizeAccounting: normalizeAccounting, scrubDescription: scrubDescription, fmtMoney: fmtMoney,
              neededCurrencies: neededCurrencies, fallbackRates: fallbackRates, earliestDate: earliestDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    global.ExpenseSplit = api;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
})(typeof window !== 'undefined' ? window : this);
