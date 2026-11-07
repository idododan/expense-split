# SPEC — expense-split

Made from `handover/BRIEF.md` and `handover/feed-contract.md` (§10, one file per
project). Where this file and the brief disagree, the brief wins and this file is fixed.

## 1. What it is

A static page, deployed once on GitHub Pages from `idododan/expense-split`, that shows
for ONE project at a time who owes whom. `?project=<id>` picks the project from
`projects.json`. Per project it reads two files from that project's data repo:

| File | Written by | Read by the app | Written by the app |
|---|---|---|---|
| `data/expenses.json` | expenses-collector only | yes | never |
| `data/accounting.json` | owner / this app's Apps Script | yes | appends settlements only |

Reads go through `api.github.com/repos/<repo>/contents/<path>?ref=<branch>` with
`Accept: application/vnd.github.raw+json` (not raw.githubusercontent.com, which caches
for minutes). Until a data repo has its `accounting.json`, a project can use the
`local` source (files served next to the page); `&source=local|github` overrides
`projects.json` for one visit.

## 2. Owner decisions (closed)

- One codebase for all projects; no framework, no build step.
- Data per project in its own public repo: `idododan/mgs-expenses`,
  `idododan/yourrights-expenses`. App repo: `idododan/expense-split`.
- Every receipt in a project's feed is split (`vendors: "*"`), 50/50:
  MGS = Ido & Guy (start 2026-06-07, history from the old page);
  YourRights = Ido & Omri (start 2026-09-01, no history).
- The existing MGS balance with Guy carries over exactly (§7).
- Payments are entered in the UI by the owner only (one PIN per project); editing or
  removing a payment stays a file edit.
- Summary card layout "A"; otherwise the look of the old page (colours, Heebo, settle
  note).

## 3. Feed (`data/expenses.json`, contract §10)

```json
{ "project": {"id": "mgs", "name": "MGS-Finance / TRS"},
  "generated_at": "…",
  "expenses": [ { "id", "date", "merchant", "merchant_raw", "reference", "amount",
                  "currency", "status", "subject", "project", "shared",
                  "receipt_total", … } ] }
```

- `id` is stable per receipt file; `reference` identifies the vendor document.
- `status: "needs_parsing"` rows (amount `null` or tentative): shown, not summed (O2).
- `receipt_total` set ⇒ `amount` is already this project's part: never divide again.
- `shared: true, receipt_total: null` ⇒ the full amount is in both projects' files
  (Anthropic today). Per the owner's decision every row is split within its project at
  its feed `amount` (see open point O1).
- A row that disappears from a later snapshot disappears from the page.

## 4. Accounting (`data/accounting.json`)

```json
{
  "project": "mgs",
  "display_currency": "USD",
  "accounting_start": "2026-06-07",
  "paid_by": "Ido",
  "partners": [ {"name": "Ido", "share": 0.5}, {"name": "Guy", "share": 0.5} ],
  "vendors": "*",
  "excluded": [],
  "history": [ {"date", "merchant", "reference", "amount", "currency", "desc", "paid_by"} ],
  "settlements": [ {"date", "by", "amount", "currency", "note", "ils_per_usd"?} ],
  "adjustments": [ {"date", "partner", "amount", "currency", "note"} ]
}
```

- `vendors`: `"*"` or a list of merchant names.
- `excluded`: feed `id`s or `reference`s that must not count (shown under "Not split").
- `history`: rows from before the feed; never disappear.
- `settlements`: a partner's payment to `paid_by`; never disappear; appended by the app.
  `ils_per_usd` (optional): the rate on the payment's date; fixes its value (O4).
- `adjustments`: `amount` > 0 increases what `partner` owes, < 0 decreases it.

## 5. Balance rule

```
counted rows  = feed rows ∪ history rows, deduplicated by reference (feed row wins;
                a history row without a feed row still counts),
                date ≥ accounting_start, merchant in vendors, id/reference not excluded,
                amount is a number, status is not needs_parsing
total         = Σ counted rows, each converted to display_currency
share(p)      = total × shares[p]
balance(p)    = share(p) − Σ settlements by p + Σ adjustments for p   (p ≠ paid_by)
since-last    = Σ counted rows dated AFTER the latest settlement
                (no settlement yet → all counted rows since accounting_start)
carried(p)    = balance(p) − since-last × shares[p]   (shown when |carried| ≥ $0.01)
```

Currency conversion: one USD/ILS rate, live from Frankfurter, fallback open.er-api.com,
last resort a fixed rate (3.0129, the old page's), exactly as the old page. ILS
settlements with `ils_per_usd` use that rate; others use the live rate.

## 6. Page

Header (old gradient): project name; subtitle "Ido & Guy 50/50 · since Jun 7, 2026".
Summary card (mockup A):

```
TO SPLIT SINCE LAST PAYMENT (Aug 13)
         $X                        ← since-last
──────────────────────────
Guy owes Ido   $Y                  ← balance (one line per non-payer partner)
incl. $Z carried over from before  ← only when carried ≠ 0
✅ Guy paid ₪465 on Aug 13 — new balance counts from here. · 1 USD = ₪…
     [ + Add payment ]
```

Below: "Receipts since Aug 13 (n)" newest first; collapsed "Earlier receipts
(settled)"; collapsed "Not split" (history before the accounting start, excluded rows).
Each receipt: merchant + description (history `desc`, else the `subject` with vendor
boilerplate removed), date, reference, amount, converted amount, "half: …" (or
"<partner>'s share" when shares are not equal), a "not parsed" mark for rows with no
amount. Footer: "Since Jun 7: $total spent · Guy paid $paid · n receipts".

`&only=Anthropic` (debug/parity view) narrows `vendors` for this visit only, for the
cut-over comparison with the old Claude-only page.

## 7. MGS history migration

`tools/migrate_with_claude.py spending.html` → MGS `accounting.json`: every
`ALL_RECEIPTS` row → `history` (`reference` = receipt number, merchant Anthropic,
USD, `desc`, `paid_by`), the three `SETTLEMENTS` (Guy $65.39 2026-06-18; ₪347
2026-07-14; ₪465 2026-08-13), start 2026-06-07, Ido/Guy 0.5/0.5, `paid_by` Ido,
`vendors` "*". Pre-June rows stay visible and unsplit.

Check numbers (Anthropic only, from the brief): since 2026-06-07 $1,020.51 over 35
rows; after 2026-08-13 $347.31 over 7 rows. With `vendors: "*"` the real numbers are
higher by the other MGS receipts; the difference is shown to the owner before cut-over.

## 8. Adding a payment

Form: date (today), paid by (partners except `paid_by`), amount, currency (USD/ILS),
note, PIN (remembered per project in `localStorage`). The page calls the Apps Script
web app by JSONP (`apps_script_url` in `projects.json`, one deployment for all
projects) with `action=add_payment&project&pin&date&by&amount&currency&note`.

The script (`apps-script/Code.gs`): checks the PIN (`PIN_<project>` in Script
Properties; failed attempts throttled), reads `accounting.json` from the project repo
(`REPO_<project>`, token `GITHUB_TOKEN`, fine-grained, contents:write on the data repos
only) through the Contents API, validates, appends the settlement, commits
`payment: Guy ₪465 on 2026-08-13`, returns `{ok}` or `{error}`. The page then re-reads
`accounting.json` and re-renders. With the `local` source the form only previews the
payment in memory (nothing is saved).

## 9. Phases (stop for the owner's review at each boundary)

- **A — Setup**: CLAUDE.md, SPEC.md, PROGRESS.md.
- **B — App runs locally with the MGS numbers**: `projects.json`, `index.html`,
  `app.js`, migration tool, local accounting files for MGS and YourRights, tests,
  `apps-script/Code.gs` written (not deployed). Review: the brief's numbers.
- **C — Live wiring** (owner's go): owner sets token + PINs, deploys the Apps Script;
  `accounting.json` files committed to the data repos; projects switch to the `github`
  source; GitHub Pages on.
- **D — Cut-over** (owner's go, brief §7): parity check against the old page, Guy gets
  the URL, `With-Claude` frozen.

## 10. Open points for the owner

- **O1 — shared Claude receipts: decided (owner, 2026-11-08).** Each project splits the
  full amount of a `shared` row with `receipt_total: null` (Guy pays $50 and Omri pays
  $50 of the same $100).
- **O2 — `needs_parsing` rows: decided (owner, 2026-11-08).** Never summed, even when
  they carry a tentative amount (MGS: 019 SMS ₪29.50 of ₪59, 2026-09-30); shown greyed
  as "not read yet · not counted" until the collector parses them.
- **O3 — the mockup headline.** $347.31 is the Anthropic-only figure; with every
  vendor split the MGS headline is higher (Render, Green API, 019 SMS since Aug 13).
- **O4 — FX carry-over: decided (owner left it to us, 2026-11-08).** A ₪ payment is
  valued at its own date's rate, stored as `ils_per_usd` on the settlement, so it does
  not drift with today's rate. The Apps Script fills it from Frankfurter when a payment
  is entered. The two migrated ₪ payments (2026-07-14, 2026-08-13) get theirs at
  cut-over: `migrate_with_claude.py --rate DATE=RATE` (this sandbox cannot reach
  Frankfurter). Until then they use today's rate, as the old page did. A remainder that
  is still left after that is real and stays as "incl. $x carried over".
- Token and PINs (brief §9).
