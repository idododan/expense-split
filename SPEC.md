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
      "local": "local/mgs"
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
  the feed with a clear "no accounting file yet" notice and no balance.

## 3. `accounting.json`

```json
{
  "schema": 1,
  "project": "mgs",
  "accounting_start": "2026-06-07",
  "display_currency": "USD",
  "paid_by": "Ido",
  "partners": [ { "name": "Ido", "share": 0.5 }, { "name": "Guy", "share": 0.5 } ],
  "vendors": "*",
  "history": [
    { "date": "2026-07-13", "merchant": "Anthropic", "description": "Max plan – 5x (Jul 13–Aug 13)",
      "amount": 100.0, "currency": "USD", "reference": "2255-1861-9763", "paid_by": "Ido" }
  ],
  "settlements": [
    { "id": "p-2026-08-13-1", "date": "2026-08-13", "paid_by": "Guy", "amount": 465, "currency": "ILS",
      "note": "his half of spending through mid-Aug", "added_at": "2026-11-08T10:00:00Z", "added_by": "migration" }
  ],
  "adjustments": [
    { "date": "2026-09-01", "partner": "Guy", "amount": -12.5, "currency": "USD", "note": "…" }
  ],
  "excluded": [ "<feed row id>" ]
}
```

| Field | Meaning |
|---|---|
| `accounting_start` | first date that counts (inclusive). Earlier rows are shown, not split. |
| `display_currency` | currency of every total on the page. Rows and payments in other currencies are converted at today's rate (§5). |
| `paid_by` | the partner who pays the bills. Every other partner owes their share. |
| `partners` | ordered; shares sum to 1. First listed is shown first. |
| `vendors` | `"*"` = every feed row counts; otherwise a list of merchant names (case-insensitive) that count. |
| `history` | receipts from before the feed existed. `reference` is the vendor's document number and is how a history row is matched to a feed row. |
| `settlements` | partner payments. `amount` is positive, in `currency`. Appended by the payments script; edited or removed only by hand. |
| `adjustments` | signed amounts added to a partner's balance (positive = owes more). |
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
value(row)    = amount converted to display_currency
                (for a shared row with `receipt_total` set, `amount` is already this
                 project's part — never divide again; with `receipt_total` null the full
                 amount counts, see §9)
total         = Σ value(counted rows)
share[p]      = total × shares[p]                       for each partner p ≠ paid_by
paid[p]       = Σ value(settlements by p)
adjusted[p]   = Σ value(adjustments for p)
balance[p]    = share[p] − paid[p] + adjusted[p]       (< 0 → paid_by owes p)
last_payment  = latest settlement date by any partner ≠ paid_by (null if none)
since_last    = Σ value(counted rows with date > last_payment)   (no payment → = total)
carried[p]    = balance[p] − since_last × shares[p]    shown when |carried| ≥ 0.005
```

Rows with `amount: null` (`status: needs_parsing`) are listed with "amount pending" and
left out of every sum. A feed row that disappears from a later snapshot disappears from
the page; history rows and settlements never do.

## 5. Currency

Rates are fetched at load for the currencies present, base = `display_currency`:
Frankfurter (`api.frankfurter.app/latest?from=USD&to=ILS,…`), then
`open.er-api.com/v6/latest/USD`, then a built-in last-known table (shown as "offline
rate"). Everything, including old shekel payments, converts at today's rate, as the old
page did. The rate and its date are printed under the balance.

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
3. Appends `{id:"p-<date>-<n>", date, paid_by, amount, currency, note, added_at, added_by:"web"}`
   to `settlements`, writes the file back with the file's `sha` (one retry on a 409),
   commit message `payment: Guy ₪465 on 2026-08-13`.
4. Returns `{ok:true, commit:"<sha>", accounting:{…}}`. The page renders the returned
   file at once; the next load reads it from GitHub.

`GET payments_url?action=ping&project=mgs` returns `{ok:true, project:"mgs"}` (no PIN) for
checking the deployment. `GET …?action=add_payment&…&callback=fn` is the JSONP fallback
with the same fields.

## 7. Tools

| Tool | Does |
|---|---|
| `tools/migrate_with_claude.py IN.html OUT.json` | turns the old page into the MGS `accounting.json`: every `ALL_RECEIPTS` row → `history` (reference = receipt number, pre-June rows included), the three `SETTLEMENTS`, start 2026-06-07, Ido/Guy 0.5/0.5, vendors `*`. |
| `tools/new_accounting.py --project ID --name … --start DATE --partners Ido:0.5 Omri:0.5 OUT.json` | an empty-history accounting file. |
| `tools/check_balance.py PROJECT [--vendors Anthropic] [--rate 3.6] [--dir local/…]` | §4 in Python, prints counted rows, total, since-last, balance; `--vendors Anthropic` reproduces the old page's Claude-only view and prints the difference. |
| `tools/test_ledger.js` | runs `computeLedger` from `app.js` under Node against the local MGS data and fixed cases. |

`local/<project>/expenses.json` is a copy of the sample feed; `local/<project>/accounting.json`
is generated. Both are committed so `source=local` works on Pages too.

## 8. Page

Same look as the old page (Heebo, pink→blue header, white cards, 24 px radius).
Summary card, mockup A from the brief:

```
MGS-Finance / TRS · Ido & Guy 50/50
TO SPLIT SINCE LAST PAYMENT (Aug 13)
$347.31
──────────
Guy owes Ido   $173.66
  incl. $x carried over from before          (only when carried ≠ 0)
✅ Guy paid ₪465 (~$…) on Aug 13 · 1 USD = ₪… (date)
[ + Add payment ]
Receipts since Aug 13 (7)       newest first: date · merchant · description · amount
                                (converted) · "half: …"
▸ Earlier receipts (settled)    collapsed; includes pre-start rows marked "before start"
footer: Since Jun 7: $1,020.51 spent · Guy paid $335.74 · 35 receipts · feed 2026-11-07 22:36
```

Description = the history row's `description` when matched, else the feed `subject`
scrubbed of "Your receipt from …", the merchant name and the reference; else the merchant.

## 9. Choices made here (owner to confirm at review)

1. **Display currency.** USD for MGS, as the brief says. The old page actually shows its
   totals in ₪ with $ per receipt; the new page shows $ with ₪ per receipt.
2. **Shared Anthropic receipts.** Since Sep 2026 the Anthropic receipts are in both
   feeds with `receipt_total: null`, so each project counts the full amount: Guy owes half
   of each in MGS and Omri owes half of the same receipt in YourRights. That follows the
   brief and the contract ("how to divide it is the split apps' business" + "every
   receipt in a project's feed is split"), and it is what makes the $1,020.51 parity
   number come out. If the owner wants each project to carry half instead, the collector
   should export them with `share = "even"`; nothing changes in this app.
3. **Matched history rows keep their description.** The old page's descriptions ("Max
   plan – 5x (Jul 13–Aug 13)") are better than the feed subjects, so when a history row
   matches a feed row the feed's amount counts and the history's description is shown.
4. **Project → repo map for the payments script** comes from this repo's `projects.json`
   on GitHub, so adding a project is one file edit plus one PIN property.
5. **POST, not JSONP, for payments**, so the PIN is not in a URL. JSONP kept as fallback.
