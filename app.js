/* expense-split — one split page for every project.
 *
 * Part 1 (pure, also loaded by Node tests): build rows and compute the balance
 *   from a feed (data/expenses.json) and an accounting file (data/accounting.json).
 * Part 2 (browser only): load the files, fetch the USD/ILS rate, render, and
 *   add a payment through the Apps Script web app.
 * Behaviour is specified in SPEC.md §5–§8.
 */
(function (root) {
  "use strict";

  // ───────────────────────── Part 1: computation ─────────────────────────

  var FALLBACK_ILS_PER_USD = 3.0129; // the old MGS page's last known rate

  function isNum(x) { return typeof x === "number" && isFinite(x); }
  function round2(n) { return Math.round(n * 100) / 100; }

  // Convert an amount to the display currency. Returns null when not possible.
  function convert(amount, cur, displayCur, ilsPerUsd) {
    if (!isNum(amount)) return null;
    cur = cur || displayCur;
    if (cur === displayCur) return amount;
    if (cur === "ILS" && displayCur === "USD") return amount / ilsPerUsd;
    if (cur === "USD" && displayCur === "ILS") return amount * ilsPerUsd;
    return null; // unknown currency pair
  }

  var BOILERPLATE = /\b(your|receipt|invoice|order|electronic|from|payment|the|for|a|of|inc|pbc|llc|ltd|pte|co|corp|dba|services|new)\b/gi;

  // A readable description: the history `desc` when known, else the subject with
  // the vendor boilerplate ("Your receipt from X #ref") removed.
  function describe(subject, merchant, merchantRaw, reference) {
    var s = String(subject || "");
    if (reference) s = s.split("#" + reference).join("").split(reference).join("");
    var rest = s;
    [merchantRaw, merchant].forEach(function (m) {
      if (m) rest = rest.split(m).join(" ").replace(new RegExp(escapeRe(m), "ig"), " ");
    });
    rest = rest.replace(BOILERPLATE, " ").replace(/[\s\W_]+/g, "");
    if (!rest) return "";
    s = s.replace(/^\s*your\s+(receipt|invoice)\s+from\s+/i, "");
    if (merchantRaw && s.indexOf(merchantRaw) === 0) s = s.slice(merchantRaw.length);
    return s.replace(/\(\s*\)/g, "").replace(/^[\s,:;·\-–—#()]+|[\s,:;·\-–—#(]+$/g, "");
  }
  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  /**
   * compute(feed, acc, opts) → model for the page.
   *   feed: parsed data/expenses.json ({expenses: [...]}) — may be null
   *   acc:  parsed data/accounting.json
   *   opts: { ilsPerUsd, only: [merchant names] narrowing vendors for this view }
   */
  function compute(feed, acc, opts) {
    opts = opts || {};
    var rate = isNum(opts.ilsPerUsd) ? opts.ilsPerUsd : FALLBACK_ILS_PER_USD;
    var disp = acc.display_currency || "USD";
    var start = acc.accounting_start || "0000-00-00";
    var payer = acc.paid_by;
    var partners = (acc.partners || []).slice();
    var shares = {};
    partners.forEach(function (p) { shares[p.name] = p.share; });
    var warnings = [];
    var shareSum = partners.reduce(function (s, p) { return s + (p.share || 0); }, 0);
    if (Math.abs(shareSum - 1) > 1e-9) warnings.push("Partner shares add up to " + shareSum + ", not 1.");

    var vendors = acc.vendors === "*" || acc.vendors == null ? null : acc.vendors.slice();
    if (opts.only && opts.only.length) {
      vendors = (vendors || opts.only).filter(function (v) { return opts.only.indexOf(v) !== -1; });
    }
    var excluded = {};
    (acc.excluded || []).forEach(function (x) { excluded[x] = true; });

    var history = acc.history || [];
    var histByRef = {};
    history.forEach(function (h) { if (h.reference) histByRef[h.reference] = h; });

    // 1. Feed rows, deduplicated by reference (first one wins).
    var rows = [];
    var seenRef = {};
    ((feed && feed.expenses) || []).forEach(function (e) {
      var h = e.reference ? histByRef[e.reference] : null;
      var row = {
        id: e.id, date: e.date, merchant: e.merchant, reference: e.reference || null,
        amount: e.amount, currency: e.currency || null, status: e.status,
        shared: !!e.shared, receipt_total: isNum(e.receipt_total) ? e.receipt_total : null,
        desc: h && h.desc ? h.desc : describe(e.subject, e.merchant, e.merchant_raw, e.reference),
        origin: "feed"
      };
      if (row.reference && seenRef[row.reference]) {
        row.skip = "duplicate of #" + row.reference;
      } else if (row.reference) {
        seenRef[row.reference] = true;
      }
      rows.push(row);
    });

    // 2. History rows without a feed row.
    history.forEach(function (h) {
      if (h.reference && seenRef[h.reference]) return; // feed row wins
      if (h.reference) seenRef[h.reference] = true;
      if (h.paid_by && payer && h.paid_by !== payer) {
        warnings.push("History row " + (h.reference || h.date) + " was paid by " + h.paid_by +
          "; only receipts paid by " + payer + " are supported.");
      }
      rows.push({
        id: h.reference || ("history-" + h.date + "-" + h.amount),
        date: h.date, merchant: h.merchant || "", reference: h.reference || null,
        amount: h.amount, currency: h.currency || disp, status: "ok",
        shared: false, receipt_total: null, desc: h.desc || "", origin: "history"
      });
    });

    // 3. Settlements and the date the "since last payment" window opens.
    // A payment's value is fixed at its own date's rate (`ils_per_usd`, written by the
    // Apps Script) so it does not drift with today's rate; without one, today's rate.
    var settlements = (acc.settlements || []).map(function (s) {
      var locked = isNum(s.ils_per_usd) && s.ils_per_usd > 0;
      return {
        date: s.date, by: s.by, amount: s.amount, currency: s.currency || disp, note: s.note || "",
        rate: locked ? s.ils_per_usd : rate, locked: locked,
        value: convert(s.amount, s.currency || disp, disp, locked ? s.ils_per_usd : rate)
      };
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var last = settlements.length ? settlements[settlements.length - 1] : null;
    var lastDate = last ? last.date : null;

    // 4. Classify each row.
    var total = 0, sinceLast = 0, nCounted = 0, nSince = 0;
    var byMerchant = {};
    rows.forEach(function (r) {
      r.value = convert(r.amount, r.currency, disp, rate);
      if (r.skip) { /* duplicate */ }
      else if (r.date < start) r.skip = "before the accounting start";
      else if (excluded[r.id] || (r.reference && excluded[r.reference])) r.skip = "excluded";
      else if (vendors && vendors.indexOf(r.merchant) === -1) r.skip = "vendor not split";
      r.after = !lastDate || r.date > lastDate;
      // A row the collector has not finished reading is shown but never summed,
      // even when it already carries a tentative amount (owner, 2026-11-08).
      r.pending = r.status === "needs_parsing";
      r.counted = !r.skip && !r.pending && r.value !== null;
      r.unparsed = !r.skip && !r.counted;
      if (r.counted) {
        total += r.value; nCounted++;
        byMerchant[r.merchant] = (byMerchant[r.merchant] || 0) + r.value;
        if (r.after) { sinceLast += r.value; nSince++; }
      }
    });
    rows.sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.origin === b.origin ? 0 : a.origin === "feed" ? -1 : 1);
    });

    // 5. Balances: share − settlements + adjustments, for every partner but the payer.
    var balances = partners.filter(function (p) { return p.name !== payer; }).map(function (p) {
      var paid = 0, adj = 0;
      settlements.forEach(function (s) {
        if (s.by !== p.name) return;
        if (s.value === null) warnings.push("Settlement on " + s.date + " has an unknown currency.");
        else paid += s.value;
      });
      (acc.adjustments || []).forEach(function (a) {
        if (a.partner !== p.name) return;
        var v = convert(a.amount, a.currency || disp, disp, rate);
        if (v === null) warnings.push("Adjustment on " + a.date + " has an unknown currency.");
        else adj += v;
      });
      var share = total * p.share;
      var balance = share - paid + adj;
      return {
        partner: p.name, share: share, paid: paid, adjustments: adj, balance: balance,
        sinceShare: sinceLast * p.share, carried: balance - sinceLast * p.share
      };
    });

    return {
      displayCurrency: disp, ilsPerUsd: rate, accountingStart: start, payer: payer,
      partners: partners, vendors: vendors, rows: rows, settlements: settlements,
      lastSettlement: last, total: total, nCounted: nCounted,
      sinceLast: sinceLast, nSince: nSince, byMerchant: byMerchant,
      balances: balances, warnings: warnings
    };
  }

  var core = { compute: compute, convert: convert, describe: describe, round2: round2,
               FALLBACK_ILS_PER_USD: FALLBACK_ILS_PER_USD };
  if (typeof module !== "undefined" && module.exports) module.exports = core;
  root.ExpenseSplit = core;
  if (typeof document === "undefined") return;

  // ───────────────────────── Part 2: the page ─────────────────────────

  var state = {
    config: null, id: null, project: null, source: null, only: null,
    feed: null, acc: null, fx: { ilsPerUsd: FALLBACK_ILS_PER_USD, date: null, live: false }
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function sym(cur) { return cur === "ILS" ? "₪" : cur === "USD" ? "$" : (cur ? cur + " " : ""); }
  function money(n, cur) {
    var neg = n < 0 ? "−" : "";
    return neg + sym(cur) + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function moneyShort(n, cur) { // ₪465 rather than ₪465.00 for whole amounts
    return Math.round(n * 100) % 100 === 0 ? sym(cur) + Math.round(n).toLocaleString("en-US") : money(n, cur);
  }
  function fmtDate(iso) {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  function fmtDay(iso) {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  function todayIso() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  var toastTimer;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 4200);
  }

  // ── Loading ──
  function getJson(url, opts) {
    return fetch(url, opts).then(function (r) {
      if (!r.ok) throw new Error(url + " → HTTP " + r.status);
      return r.json();
    });
  }

  function loadFile(which) { // which: "expenses" | "accounting"
    var p = state.project;
    if (state.source === "github") {
      var url = "https://api.github.com/repos/" + p.repo + "/contents/data/" + which + ".json" +
        "?ref=" + encodeURIComponent(p.branch || "main") + "&t=" + Date.now();
      return getJson(url, { headers: { Accept: "application/vnd.github.raw+json" }, cache: "no-store" });
    }
    return getJson(p.local[which] + "?t=" + Date.now(), { cache: "no-store" });
  }

  function fetchRate() {
    function apply(rate, date) {
      state.fx = { ilsPerUsd: rate, date: date, live: true };
      if (state.acc) render();
    }
    return getJson("https://api.frankfurter.app/latest?from=USD&to=ILS")
      .then(function (d) { if (!d || !d.rates || !d.rates.ILS) throw new Error("no rate"); apply(d.rates.ILS, d.date); })
      .catch(function () {
        return getJson("https://open.er-api.com/v6/latest/USD").then(function (d) {
          if (!d || !d.rates || !d.rates.ILS) throw new Error("no rate");
          apply(d.rates.ILS, (d.time_last_update_utc || "").slice(0, 16));
        });
      })
      .catch(function () { /* keep the fallback rate */ });
  }

  function start() {
    var q = new URLSearchParams(location.search);
    getJson("projects.json", { cache: "no-store" }).then(function (cfg) {
      state.config = cfg;
      state.id = (q.get("project") || "").toLowerCase();
      state.project = cfg.projects[state.id];
      if (!state.project) return renderPicker(cfg);
      state.source = q.get("source") || state.project.source || "github";
      state.only = q.get("only") ? q.get("only").split(",").map(function (s) { return s.trim(); }) : null;
      document.title = state.project.name + " — expense split";
      fetchRate();
      return Promise.all([loadFile("expenses"), loadFile("accounting")]).then(function (res) {
        state.feed = res[0];
        state.acc = res[1];
        render();
      });
    }).catch(function (err) {
      $("content").innerHTML = '<div class="summary error">Could not load the data.<br><small>' +
        esc(err.message) + "</small></div>";
    });
  }

  function renderPicker(cfg) {
    $("eyebrow").textContent = "Expense split";
    $("title").textContent = "Pick a project";
    $("subtitle").textContent = "";
    $("content").innerHTML = '<div class="summary picker">' + Object.keys(cfg.projects).map(function (id) {
      return '<a href="?project=' + encodeURIComponent(id) + '">' + esc(cfg.projects[id].name) + "</a>";
    }).join("") + "</div>";
  }

  // ── Rendering ──
  function render() {
    var acc = state.acc;
    var m = compute(state.feed, acc, { ilsPerUsd: state.fx.ilsPerUsd, only: state.only });
    var disp = m.displayCurrency;
    var other = disp === "USD" ? "ILS" : "USD";
    var names = m.partners.map(function (p) { return p.name; });
    var equal = m.partners.every(function (p) { return p.share === m.partners[0].share; });
    var splitLabel = names.join(" & ") + " " + m.partners.map(function (p) { return Math.round(p.share * 100); }).join("/");
    var last = m.lastSettlement;

    $("eyebrow").textContent = "Expense split 💸";
    $("title").textContent = state.project.name;
    $("subtitle").textContent = splitLabel + " · since " + fmtDate(m.accountingStart) +
      (state.only ? " · only " + state.only.join(", ") : "") +
      (state.source === "local" ? " · local data" : "");

    var html = [];
    if (m.warnings.length) html.push('<div class="warn">⚠️ ' + m.warnings.map(esc).join("<br>⚠️ ") + "</div>");

    // Summary card (mockup A)
    html.push('<div class="summary">');
    html.push('<div class="total-row"><div class="total-label">' +
      (last ? "TO SPLIT SINCE LAST PAYMENT (" + fmtDay(last.date) + ")" : "TO SPLIT SINCE " + fmtDay(m.accountingStart).toUpperCase()) +
      '</div><div class="total-amount">' + money(m.sinceLast, disp) + "</div></div>");
    html.push('<div class="divider"></div>');
    m.balances.forEach(function (b) {
      var owes = b.balance >= 0.005;
      var owed = b.balance <= -0.005;
      html.push('<div class="balance-row">');
      html.push('<div class="balance-label">' + (owes ? esc(b.partner) + " owes " + esc(m.payer)
        : owed ? esc(m.payer) + " owes " + esc(b.partner) : esc(b.partner) + " · all settled up 🎉") + "</div>");
      html.push('<div class="balance-amount">' + money(Math.abs(b.balance), disp) + "</div>");
      if (Math.abs(b.carried) >= 0.005) {
        html.push('<div class="carried">incl. ' + money(b.carried, disp) + " carried over from before</div>");
      }
      html.push("</div>");
    });
    if (last) {
      var paidStr = moneyShort(last.amount, last.currency);
      var rateStr = "";
      if (last.currency !== disp && last.value !== null) {
        paidStr += " (~" + money(last.value, disp) + ")";
        rateStr = last.locked
          ? " · at that day's rate, 1 USD = ₪" + last.rate.toFixed(4)
          : " · 1 USD = ₪" + m.ilsPerUsd.toFixed(4) +
            (state.fx.live ? (state.fx.date ? " (" + state.fx.date + ")" : " (live)") : " (offline rate)");
      }
      html.push('<div class="settle-note">✅ ' + esc(last.by) + " paid " + esc(paidStr) + " on " + fmtDay(last.date) +
        " — new balance counts from here." + esc(rateStr) + "</div>");
    }
    html.push('<div class="pay-wrap"><button class="pay-btn" id="pay-btn" type="button">+ Add payment</button></div>');
    html.push('<div id="pay-form-slot"></div>');
    html.push("</div>");

    // Receipt lists
    var since = m.rows.filter(function (r) { return !r.skip && r.after; });
    var settled = m.rows.filter(function (r) { return !r.skip && !r.after; });
    var notSplit = m.rows.filter(function (r) { return r.skip; });
    var shareOf = equal && m.partners.length === 2 ? "half" : null;

    function receipt(r) {
      var conv = "";
      if (r.value !== null && r.currency && r.currency !== disp) conv = money(r.value, disp);
      else if (r.value !== null) {
        var o = convert(r.amount, r.currency || disp, other, m.ilsPerUsd);
        if (o !== null) conv = money(o, other);
      }
      var meta = [fmtDate(r.date)];
      if (r.reference) meta.push("#" + esc(r.reference));
      if (r.shared) meta.push("shared");
      if (r.receipt_total !== null) meta.push("part of " + money(r.receipt_total, r.currency));
      if (r.origin === "history") meta.push("from the old page");
      var amountHtml, sub;
      if (r.value === null && !isNum(r.amount)) {
        amountHtml = '<span class="na">—</span>';
        sub = "amount not read yet";
      } else if (r.pending && !r.skip) {
        amountHtml = '<span class="na">' + money(r.amount, r.currency) + "</span>";
        sub = "not read yet · not counted";
      } else if (r.value === null) {
        amountHtml = money(r.amount, r.currency);
        sub = "unknown currency";
      } else {
        amountHtml = money(r.amount, r.currency || disp) + (conv ? ' <span class="conv">(' + conv + ")</span>" : "");
        if (r.skip) sub = "not split";
        else if (shareOf) sub = "half: " + money(r.value * m.partners[0].share, disp);
        else sub = m.partners.filter(function (p) { return p.name !== m.payer; }).map(function (p) {
          return esc(p.name) + ": " + money(r.value * p.share, disp);
        }).join(" · ");
      }
      return '<div class="receipt' + (r.skip ? " skipped" : "") + (r.unparsed ? " unparsed" : "") + '">' +
        '<div class="icon">' + (r.unparsed ? "❓" : "🧾") + "</div>" +
        '<div class="info"><div class="desc">' + esc(r.merchant) +
        (r.desc ? ' <span class="sub">' + esc(r.desc) + "</span>" : "") + "</div>" +
        '<div class="meta">' + meta.join(" · ") + (r.skip ? " · " + esc(r.skip) : "") + "</div></div>" +
        '<div class="money"><div class="amount">' + amountHtml + '</div><div class="half">' + sub + "</div></div></div>";
    }

    var sinceUnread = since.filter(function (r) { return r.unparsed; }).length;
    html.push('<div class="section-title">' + (last ? "Receipts since " + fmtDay(last.date) : "Receipts") +
      " (" + (since.length - sinceUnread) + ")" + (sinceUnread ? " · " + sinceUnread + " amount not read yet" : "") + "</div>");
    html.push(since.length ? since.map(receipt).join("") : '<div class="empty">No receipts since then.</div>');
    if (settled.length) {
      html.push('<details class="group"><summary class="section-title">Earlier receipts (settled) (' + settled.length + ")</summary>" +
        settled.map(receipt).join("") + "</details>");
    }
    if (notSplit.length) {
      html.push('<details class="group"><summary class="section-title">Not split (' + notSplit.length + ")</summary>" +
        notSplit.map(receipt).join("") + "</details>");
    }
    $("content").innerHTML = html.join("");

    // Footer
    var paidParts = m.balances.map(function (b) { return esc(b.partner) + " paid " + money(b.paid, disp); });
    $("footer").innerHTML = "Since " + fmtDay(m.accountingStart) + ": " + money(m.total, disp) + " spent · " +
      paidParts.join(" · ") + " · " + m.nCounted + " receipts" +
      (state.feed && state.feed.generated_at ? '<br>feed updated ' + esc(state.feed.generated_at.replace("T", " ").replace("Z", " UTC")) : "");

    $("pay-btn").onclick = function () { togglePayForm(m); };
  }

  // ── Add a payment ──
  function pinKey() { return "expense-split.pin." + state.id; }
  function storedPin() { try { return localStorage.getItem(pinKey()) || ""; } catch (e) { return ""; } }
  function storePin(pin) { try { localStorage.setItem(pinKey(), pin); } catch (e) { /* ignore */ } }

  function togglePayForm(m) {
    var slot = $("pay-form-slot");
    if (slot.innerHTML) { slot.innerHTML = ""; return; }
    var who = m.partners.filter(function (p) { return p.name !== m.payer; });
    slot.innerHTML =
      '<form class="pay-form" id="pay-form" autocomplete="off">' +
      '<label>Date<input type="date" name="date" required value="' + todayIso() + '"></label>' +
      '<label>Paid by<select name="by">' + who.map(function (p) {
        return "<option>" + esc(p.name) + "</option>";
      }).join("") + "</select></label>" +
      '<div class="pair"><label>Amount<input type="number" name="amount" step="0.01" min="0.01" required inputmode="decimal"></label>' +
      '<label>Currency<select name="currency"><option>ILS</option><option>USD</option></select></label></div>' +
      '<label>Note<input type="text" name="note" maxlength="200" placeholder="optional"></label>' +
      '<label>Project PIN<input type="password" name="pin" required value="' + esc(storedPin()) + '"></label>' +
      '<div class="pay-actions"><button type="button" class="link-btn" id="pay-cancel">Cancel</button>' +
      '<button type="submit" class="pay-btn" id="pay-submit">Save payment</button></div>' +
      '<div class="pay-hint">Payee: ' + esc(m.payer) + ". Saved as a commit in " + esc(state.project.repo) +
      ". To change or remove a payment, edit data/accounting.json.</div></form>";
    $("pay-cancel").onclick = function () { slot.innerHTML = ""; };
    $("pay-form").onsubmit = function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var pay = {
        date: f.date.value, by: f.by.value, amount: Math.round(parseFloat(f.amount.value) * 100) / 100,
        currency: f.currency.value, note: f.note.value.trim()
      };
      if (!/^\d{4}-\d\d-\d\d$/.test(pay.date) || !(pay.amount > 0)) { toast("Check the date and amount."); return; }
      storePin(f.pin.value);
      submitPayment(pay, f.pin.value);
    };
  }

  function submitPayment(pay, pin) {
    var btn = $("pay-submit");
    if (state.source === "local") {
      if (pay.currency === "ILS" && state.fx.live) pay.ils_per_usd = state.fx.ilsPerUsd;
      state.acc.settlements = (state.acc.settlements || []).concat([pay]);
      render();
      toast("Local data: payment shown for preview only, nothing was saved.");
      return;
    }
    var url = state.config.apps_script_url;
    if (!url) { toast("apps_script_url is not set in projects.json yet."); return; }
    btn.disabled = true;
    btn.textContent = "Saving…";
    jsonp(url, {
      action: "add_payment", project: state.id, pin: pin, date: pay.date, by: pay.by,
      amount: String(pay.amount), currency: pay.currency, note: pay.note
    }, 45000).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || "Unexpected response");
      toast("Saved ✅ " + (res.commit ? "commit " + String(res.commit).slice(0, 7) : ""));
      return loadFile("accounting").then(function (acc) { state.acc = acc; render(); });
    }).catch(function (err) {
      toast("Not saved: " + err.message);
      btn.disabled = false;
      btn.textContent = "Save payment";
    });
  }

  // GET with a callback (the Apps Script answers `callback(json);`), as the old page.
  function jsonp(url, params, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var cb = "esCb_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
      var qs = Object.keys(params).map(function (k) {
        return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
      }).join("&");
      var script = document.createElement("script");
      var done = false;
      function finish() {
        done = true;
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      window[cb] = function (data) { if (done) return; finish(); resolve(data); };
      script.onerror = function () { if (done) return; finish(); reject(new Error("could not reach the payment script")); };
      script.src = url + (url.indexOf("?") === -1 ? "?" : "&") + qs + "&callback=" + cb;
      document.body.appendChild(script);
      setTimeout(function () { if (done) return; finish(); reject(new Error("timed out")); }, timeoutMs);
    });
  }

  start();
})(typeof window !== "undefined" ? window : globalThis);
