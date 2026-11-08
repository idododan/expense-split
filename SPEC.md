# expense-split — specification

Derived from `handover/BRIEF.md` and `handover/feed-contract.md` (2026-11-08). Where this
file and the brief differ, the brief's owner decisions win; §9 lists the choices made
here that the brief left open.

## 1. Purpose and URLs

A static page that shows, for one project, who owes whom on shared expenses, and lets
the owner record a partner's payment.

| URL | Shows |
|---|---|
| `/?project=mgs` | MGS-Finance / TRS, Ido & Guy, from the live data repo |
| `/?project=yourrights` | YourRights, Ido & Omri |
| `/?project=mgs&source=local` | same, from `local/mgs/` (development) |
| `/` | a list of the projects in `projects.json` |

Deployed once to GitHub Pages from `idododan/expense-split` (`main`). No build step.

## 2. Files the app reads

`projects.json` (in this repo):

```json
{
  "payments_url": "https://script.google.com/macros/s/…/exec",
  "projects": {
    "mgs": {
      "name": "MGS-Finance / TRS",
      "repo": "idododan/mgs-expenses",
      "branch": "main",
      "expenses_path": "data/expenses.json",
      "accounting_path": "data/accounting.json",
      "local": "local/mgs",
      "display_currency": "ILS",
      "card": { "fee": 0.03, "lag_days": 1 }
    }
  }
}
```

Per project, from the project's own repo, through
`https://api.github.com/repos/{repo}/contents/{path}?ref={branch}` with
`Accept: application/vnd.github.raw+json` (not the raw.githubusercontent URL, which
caches for minutes; the API answers with CORS `*` and a 60 s cache). Unauthenticated,
60 requests/hour per IP, two per page load.

- `data/expenses.json` — the receipts feed, written by the collector. Contract:
  `handover/feed-contract.md`. Fields used: `id`, `date`, `merchant`, `merchant_raw`,
  `reference`, `amount` (may be `null`), `currency` (may be `null`), `status`,
  `subject`, `shared`, `receipt_total`; header `generated_at`.
- `data/accounting.json` — this app's own file, schema in §3. Written by the owner
  (migration, hand edits) and by the payments script (§6). If missing, the page shows
  the feed with a clear "no accounting file yet" notice and no balance. Both data repos
  already hold one (published by the collector session on 2026-11-07/08; the MGS one is
  the migrated old page with Guy's three payments). `local/<project>/accounting.json`
  is a copy of each.

## 3. `accounting.json`

The shape is the one the collector published (field names `desc`, `by`); the app also
accepts `description` and `paid_by`.

```json
{
  "project": "mgs",
  "display_currency": "USD",
  "accounting_start": "2026-06-07",
  "paid_by": "Ido",
  "partners": [ { "name": "Ido", "share": 0.5 }, { "name": "Guy", "share": 0.5 } ],
  "vendors": "*",
  "excluded": [ "<feed row id>" ],
  "history": [
    { "date": "2026-07-13", "merchant": "Anthropic", "reference": "2255-1861-9763",
      "amount": 100.0, "currency": "USD", "desc": "Max plan – 5x (Jul 13–Aug 13)", "paid_by": "Ido" }
  ],
  "settlements": [
    { "date": "2026-08-13", "by": "Guy", "amount": 465.0, "currency": "ILS",
      "note": "his half of spending through mid-Aug", "ils_per_usd": 2.981 },
    { "id": "p-2026-11-20-1", "date": "2026-11-20", "by": "Guy", "amount": 600, "currency": "ILS",
      "note": "", "rate": 3.19, "added_at": "2026-11-20T18:02:11Z", "added_by": "web" }
  ],
  "adjustments": [
    { "date": "2026-09-01", "partner": "Guy", "amount": -12.5, "currency": "USD", "note": "…" }
  ],
  "migrated_from": "idododan/With-Claude spending.html"
}
```

| Field | Meaning |
|---|---|
| `accounting_start` | first date that counts (inclusive). Earlier rows are shown, not split. |
| `display_currency` | currency of every total on the page; `projects.json` overrides it (ILS for both projects). Other currencies convert per §5. |
| `paid_by` | the partner who pays the bills. Every other partner owes their share. |
| `partners` | ordered; shares sum to 1. First listed is shown first. |
| `vendors` | `"*"` = every feed row counts; otherwise a list of merchant names (case-insensitive) that count. |
| `history` | receipts from before the feed existed. `reference` is the vendor's document number and is how a history row is matched to a feed row. |
| `settlements` | partner payments. `amount` is positive, in `currency`. A recorded rate is kept as a currency pair so it survives a change of display currency: `ils_per_usd` (1 USD = v ILS, as the collector wrote it) or `rate` + `rate_base` (1 `rate_base` = `rate` units of `currency`; `rate_base` defaults to USD). The pair is used when it connects `currency` with the display currency; otherwise the rate of the payment date. Appended by the payments script; edited or removed only by hand. |
| `adjustments` | signed amounts added to a partner's balance (positive = owes more); `rate` as above. |
| `excluded` | feed row `id`s that must not count (shown, struck through). |

## 4. Balance rule

```
rows          = feed rows ∪ history rows, deduplicated by `reference`
                (a feed row and a history row with the same reference are one row: the
                 feed row's date and amount count, the history row's description is shown;
                 a history row with no feed match still counts; rows with no reference
                 never collide)
counted(row)  = date ≥ accounting_start
              ∧ (vendors = "*" ∨ merchant ∈ vendors)
              ∧ id ∉ excluded
              ∧ amount ≠ null
value(row)    = amount converted to display_currency the way the owner's card did it (§5)
                (for a shared row with `receipt_total` set, `amount` is already this
                 project's part — never divide again; with `receipt_total` null the full
                 amount counts, see §9)
total         = Σ value(counted rows)
share[p]      = total × shares[p]                       for each partner p ≠ paid_by
paid[p]       = Σ value(settlements by p)      (a settlement with its own `rate` converts at
                                                 that rate, else at the rate of its date)
adjusted[p]   = Σ value(adjustments for p)     (same)
balance[p]    = share[p] − paid[p] + adjusted[p]       (< 0 → paid_by owes p)
last_payment  = latest settlement date by any partner ≠ paid_by (null if none)
since_last    = Σ value(counted rows with date > last_payment)   (no payment → = total)
carried[p]    = balance[p] − since_last × shares[p]    shown when |carried| ≥ 0.005
```

Rows with `amount: null` (`status: needs_parsing`) are listed with "amount pending" and
left out of every sum. A feed row that disappears from a later snapshot disappears from
the page; history rows and settlements never do.

## 5. Currency

Principle (owner, 2026-11-08): a partner's payment must cover their share of what the
owner actually paid. The owner pays in shekels through a credit card, so the ledger is
in ILS and a dollar receipt is worth what the card charged for it. From eight statement
lines (2026-11-08) the card's formula is exact:

```
charge (ILS) = amount (USD) × representative rate on the day AFTER the transaction × 1.03
```

The page uses the ECB rate of that day (Frankfurter) in place of the Bank of Israel
representative rate; on the five dated examples they differ by at most 0.3%, i.e. a few
agorot per receipt. `card.fee` and `card.lag_days` live in `projects.json`. Payments carry
no fee: a shekel payment counts as is; a dollar payment converts at the plain rate of its
date (or its recorded pair, §3).

At load the page fetches the daily ECB series for the currencies present, base =
`display_currency`, from the earliest date in the data
(`api.frankfurter.dev/v1/<since>..?base=USD&symbols=ILS,…`, one request; the old
`api.frankfurter.app` host redirects without CORS headers and fails in browsers). Each receipt,
payment and adjustment converts at the quote of its own date (the latest quote on or
before it; weekends take Friday's). A payment with a recorded `rate` (§3) uses that
instead. Fallbacks, in order: Frankfurter's latest rate for every date, then
`open.er-api.com`, then a built-in last-known table; the line under the balance says
which applies. A payment's rate is printed in its settle note.

## 6. Payments

Button "+ Add payment" on the summary card opens a form: date (default today), paid by
(partners other than `paid_by`), amount, currency (USD / ILS), note, project PIN
(remembered in `localStorage`, per project). Submit → `POST payments_url` with a
`text/plain` JSON body (no preflight; Apps Script's redirect is followed):

```json
{ "action": "add_payment", "project": "mgs", "pin": "…",
  "date": "2026-11-08", "paid_by": "Guy", "amount": 150, "currency": "ILS", "note": "…" }
```

`apps-script/Code.gs`, one deployment for all projects, Execute as Me, access Anyone:

1. Looks up `PIN_<project>` in Script Properties; missing → unknown project; mismatch →
   `{ok:false, error:"wrong PIN"}`. Validates date (`YYYY-MM-DD`, not in the future by
   more than a day), amount (> 0, ≤ 1,000,000), currency (USD/ILS), paid_by (a partner
   of the project, not `paid_by`), note (≤ 200 chars).
2. Reads `projects.json` from `idododan/expense-split` (the project → repo map), then
   `accounting_path` from the project's repo through the Contents API with
   `GITHUB_TOKEN` (fine-grained, contents read/write on the data repos only).
3. Looks up the rate on the payment date when the currency differs from the display
   currency (`api.frankfurter.dev/v1/<date>?base=USD&symbols=ILS`; skipped if that fails), then
   appends `{id:"p-<date>-<n>", date, by, amount, currency, note, rate?, added_at, added_by:"web"}`
   to `settlements` and writes the file back with the file's `sha` (one retry on a 409),
   commit message `payment: Guy ₪465 on 2026-08-13`.
4. Returns `{ok:true, commit:"<sha>", accounting:{…}}`. The page renders the returned
   file at once; the next load reads it from GitHub.

`GET payments_url?action=ping&project=mgs` returns `{ok:true, project:"mgs"}` (no PIN) for
checking the deployment. `GET …?action=add_payment&…&callback=fn` is the JSONP fallback
with the same fields.

## 7. Tools

| Tool | Does |
|---|---|
| `tools/migrate_with_claude.py IN.html OUT.json [--rates]` | turns the old page into the MGS `accounting.json`: every `ALL_RECEIPTS` row → `history` (reference = receipt number, pre-June rows included), the three `SETTLEMENTS` (`--rates` adds each shekel payment's Frankfurter rate on its date), start 2026-06-07, Ido/Guy 0.5/0.5, vendors `*`. The collector already published the equivalent file; this tool reproduces it (same rows, same rates) and stays for the record. |
| `tools/new_accounting.py --out OUT.json --project ID --start DATE --partners Ido:0.5 Omri:0.5` | an empty-history accounting file. |
| `tools/check_balance.py PROJECT [--vendors Anthropic] [--rate 3.6] [--dir local/…]` | §4 in Python, prints counted rows, total, since-last, balance; `--vendors Anthropic` reproduces the old page's Claude-only view and prints the difference. |
| `tools/test_ledger.js` | runs `computeLedger` from `app.js` under Node against the local MGS data and fixed cases. |

`local/<project>/expenses.json` is a copy of the sample feed; `local/<project>/accounting.json`
is a copy of the live file (2026-11-08). Both are committed so `source=local` works on
Pages too.

## 8. Page

Same look as the old page (Heebo, pink→blue header, white cards, 24 px radius).
Summary card. The brief's mockup A put "to split since last payment" on top; after the
first real payment the owner found that misleading (a ₪1 payment made the headline
$0.00), so the headline is the balance and the since-last figure is the line under it
(owner, 2026-11-08):

```
MGS-Finance / TRS · Ido & Guy 50/50
GUY OWES IDO
₪627.82
✅ Guy paid ₪465 on Aug 13, 2026 · his half of spending through mid-Aug
New since Aug 13: ₪1,192.60 in 10 receipts, Guy's share ₪596.30 · ₪31.52 still owed from before
latest 1 USD = ₪3.20 (2026-11-06) · ECB rate of the day after each receipt + 3% card fee
[ + Add payment ]
Receipts since Aug 13 (7)       newest first: date · merchant · description · amount
                                (converted) · "half: …"
▸ Earlier receipts (settled)    collapsed; includes pre-start rows marked "before start"
footer: Since Jun 7: $1,020.51 spent · Guy paid $335.74 · 35 receipts · feed 2026-11-07 22:36
```

Description = the history row's `description` when matched, else the feed `subject`
scrubbed of "Your receipt from …", the merchant name and the reference; else the merchant.

## 9. Choices made here — decided by the owner on 2026-11-08

0. **Rates: each amount at the rate of its own day** (owner: "whatever makes their share
   of my own expense covered"). The brief had said "today's rate, as the old page does";
   with today's rate Guy's balance drifted with the shekel ($191.04 Claude-only on
   2026-11-08, $17.38 of it pure FX drift). Per-day rates give $173.74, nine cents from
   the old page's $173.66. The collector's recorded `ils_per_usd` on the two shekel
   payments agrees with the ECB series to the fourth decimal.
1. **Display currency ILS, card formula** (owner, later the same day: "my rate is the
   conversion of the credit card company", with eight statement lines). Everything is
   in shekels, dollar receipts at the card's charge (§5). Consequence: the 3% fee now
   applies to every receipt since 2026-06-07, which Guy's three payments did not cover;
   that shows as ₪31.52 "still owed from before". If the owner prefers to start the fee
   from a date, set `card.from` — not built yet, say so.
2. **Shared Anthropic receipts count in full in both projects** (owner: "Guy pays half
   in MGS and Omri pays half of the same receipt in YourRights"). Since Sep 2026 these
   rows are in both feeds with `receipt_total: null`; nothing changes in the collector.
3. **Matched history rows keep their description.** The old page's descriptions ("Max
   plan – 5x (Jul 13–Aug 13)") are better than the feed subjects, so when a history row
   matches a feed row the feed's amount counts and the history's description is shown.
4. **Project → repo map for the payments script** comes from this repo's `projects.json`
   on GitHub, so adding a project is one file edit plus one PIN property.
5. **POST, not JSONP, for payments**, so the PIN is not in a URL. JSONP kept as fallback.
