# Handover: build `expense-split`, one split app for every project

From the expenses-collector session, 2026-11-07. Everything a new session needs is in
this folder: this brief, `feed-contract.md` (the exact file the collector publishes),
`samples/` (today's two project files, and the current MGS page you are replacing).

## 1. What this project is

A static web app, deployed once (GitHub Pages), that shows for ONE project at a time who
owes whom: `?project=mgs`, `?project=yourrights`, and future ones. It reads two files
from that project's own GitHub repo:

- `data/expenses.json` — the receipts feed, written by the **expenses-collector** on
  this Mac after every harvest (never by this app). Contract: `feed-contract.md`.
- `data/accounting.json` — the project's own accounting: partners and shares, accounting
  start, partner payments (settlements), history from before the feed, adjustments,
  exclusions. This app reads it and (see §5) appends payments to it. The collector never
  touches it.

It replaces the current MGS page "Claude Spending — split with Guy" (`samples/with-claude/
spending.html` + `Code.gs`, repo `idododan/With-Claude`, GitHub Pages), which keeps a
hard-coded receipt list, fetches Anthropic receipts from Gmail through an Apps Script,
and holds Guy's payments in the page source. That page is NOT to be edited; it stays up,
frozen, until the cut-over (§7).

## 2. Decisions already taken by the owner (do not re-open)

- One codebase for all projects, in this folder, its own git repo. No framework, no
  build step: `index.html` + `app.js` + `projects.json` (+ the Apps Script file).
- Data lives per project in that project's repo (names to come from the owner); the
  app reads it through `api.github.com` (not the raw URL: it caches for minutes). Both
  repos are public; the feed is already pseudonymized (no addresses, no phone numbers).
- The existing MGS balance with Guy must carry over exactly (§6).
- Payments are entered in the UI (§5); editing or removing one stays a file edit.
- Summary card layout "A" (§4). Same look and feel as the current page otherwise.
- **Every receipt in a project's feed is split** (`vendors: "*"`), 50/50 in both
  projects (owner, 2026-11-08): MGS = Ido & Guy, YourRights = Ido & Omri. YourRights:
  accounting start 2026-09-01, no history. (The current MGS page split Claude only
  because that was all it could see.)
- Repos (owner, 2026-11-08): data `idododan/mgs-expenses` and
  `idododan/yourrights-expenses` (public; the owner creates them), app
  `idododan/expense-split`.
- Payments are entered by the owner only, as his confirmation that a partner's payment
  arrived: one PIN per project, known to the owner; partners do not get it.

## 3. Balance rule

```
counted rows  = feed rows ∪ history rows, deduplicated by `reference`
                (a history row whose reference matches a feed row is NOT counted again;
                 the feed row wins; a history row with no feed row still counts),
                date ≥ accounting_start, merchant in `vendors`, id not in `excluded`
total         = Σ counted rows (feed `amount`; for a shared row with `receipt_total`
                set, `amount` is already this project's part — never divide again)
partner share = total × shares[partner]
balance       = partner share − Σ settlements by that partner (ILS converted at the
                live USD/ILS rate, Frankfurter with fallback, as the current page does)
                ± adjustments
since-last    = Σ counted rows dated AFTER the latest settlement
                (no settlement yet → since accounting_start)
```
Feed rows can have `amount: null` (`status: needs_parsing`): show them, leave them out
of sums. Rows that disappear from a later feed snapshot disappear from the page too;
history rows and settlements never do. Mixed currencies: convert to the project's
display currency (USD for MGS, as today) at the live rate.

## 4. The page (summary card, mockup A, chosen by the owner)

```
MGS-Finance / TRS · Ido & Guy 50/50
TO SPLIT SINCE LAST PAYMENT (Aug 13)
         $347.31                 ← headline: counted rows after the last payment
──────────────────────────
Guy owes Ido   $173.66           ← the true balance (share − payments ± adjustments);
✅ Guy paid ₪465 on Aug 13          when it is not exactly share-of-headline, a small
     [ + Add payment ]              line says "incl. $x carried over from before"
Receipts since Aug 13 (7) … ▸ Earlier receipts (settled)
footer, small: Since Jun 7: $1,020.51 spent · Guy paid $335.74 · 35 receipts
```
Receipts newest first, each with date, merchant, description (`subject` scrubbed of the
vendor boilerplate is fine), amount, converted amount, "half: …". Earlier (settled)
receipts collapsed. Keep the current page's colours, fonts and the settle note.

## 5. Add a payment from the page

Form: date (default today), paid by (partner list), amount, currency (USD/ILS), note,
project PIN (remembered in the browser). A public static page cannot hold a GitHub
token, so the write goes through a small Google Apps Script web app (the owner already
runs one for the current page; same deploy steps as in `samples/with-claude/Code.gs`),
one deployment for all projects:

1. The page calls it (JSONP or a GET with a callback, as today) with project id, PIN
   and the payment fields.
2. The script checks the PIN (per project, in Script Properties), reads
   `data/accounting.json` from that project's repo through the GitHub Contents API
   with a fine-grained token (contents: write on the data repos only, also in Script
   Properties — never in the page), appends the settlement, commits with a message
   like `payment: Guy ₪465 on 2026-08-13`, returns ok/error.
3. The page re-reads `accounting.json` through `api.github.com` and re-renders.

Every write is a git commit on the project repo, so nothing is lost silently.

## 6. Carrying the MGS history over (must be exact)

Source of truth today: `samples/with-claude/spending.html`:
- `ALL_RECEIPTS` (Anthropic receipts Mar–Jul 2026, each with `receipt` = the
  Anthropic receipt number, `desc`, `paidBy`), `ACCOUNTING_START = "2026-06-07"`,
  `SETTLEMENTS` (Guy: $65.39 on 2026-06-18; ₪347 on 2026-07-14; ₪465 on 2026-08-13).
- The live page's list is actually fetched from Gmail by `Code.gs` (Anthropic mails
  since the start, amount = the "$X Paid" figure, deduped by receipt number), so the
  hard-coded list is only Mar–Jul; the feed covers everything since 2026-06-07.

Write `tools/migrate_with_claude.py` (or JS) that turns `spending.html` into the MGS
`accounting.json`: `history` = every `ALL_RECEIPTS` row with `reference` = its receipt
number (pre-June rows included, so they stay visible and unsplit), `settlements` = the
three payments, `accounting_start` = 2026-06-07, partners Ido/Guy 0.5/0.5, `paid_by`
Ido, `vendors` = "*" (every receipt in the feed is split; the old page could only see
Claude). NOTE for the parity check (§7): the old page's total covers Claude only, so
compare its total with the new app's Claude-only subtotal, and expect the new balance to
be higher by Guy's half of the other MGS receipts (Green API, Render, 019 SMS…) since
2026-06-07; show the owner that difference explicitly before cut-over.

Reconciliation already done on the collector side (2026-11-07): all 16 receipts in the
page's list since 2026-06-07 exist in `samples/expenses-mgs.json` with the same
`reference` and amount (the one mismatch, 13 Jun $100.00 vs $90.54 paid, is fixed in the
feed: the collector now files the amount paid). MGS Anthropic total since 2026-06-07 =
**$1,020.51 over 35 rows**; since Guy's last payment (after 2026-08-13) = $347.31 over 7
rows (Aug 15, Sep 7, Sep 9, Oct 7, Oct 24 ×2, Nov 7). Use these to check your numbers.

## 7. Cut-over (only on the owner's go; not part of the build)

1. Owner creates the two data repos; the collector publishes `data/expenses.json`
   into each; this app's `projects.json` gets the repo names; the migration output
   goes into the MGS repo as `data/accounting.json`.
2. Deploy to GitHub Pages; open `?project=mgs`; same day, compare with the old page:
   total since start, each settlement, the balance. Fix differences in the data, never
   by editing the feed.
3. Guy gets the new URL; `With-Claude` is frozen, not deleted.

## 8. How to work in this folder

- Start with a `CLAUDE.md` (intent, branch-first, plan before building and stop for
  review at phase boundaries, `PROGRESS.md`, conventional commits) and a `SPEC.md`
  made from this brief + `feed-contract.md`. Then `git init`.
- Develop against `samples/expenses-mgs.json` and a generated `accounting.json`
  (serve the folder locally; `?project=mgs` with a `local` source until the repos
  exist).
- Stop for the owner's review after the app runs locally with the MGS numbers above.

## 9. Answered by the owner (2026-11-08) and what is still open

- Repos: data `idododan/mgs-expenses`, `idododan/yourrights-expenses`; app
  `idododan/expense-split`. Shares: 50/50 in both projects, on every receipt in the
  feed. Payments: owner only.
- Still open: the fine-grained GitHub token for the Apps Script (the owner creates it;
  it expires after at most a year), and the per-project PINs (owner picks them).

## 10. Status at handover (2026-11-08)

- All three repos exist and are public. The collector has published the first
  snapshots: `idododan/mgs-expenses` → `data/expenses.json` (42 rows, since 2026-06-07),
  `idododan/yourrights-expenses` → `data/expenses.json` (15 rows, since 2026-09-01).
  Every harvest republishes them (a commit only when the rows changed). You can develop
  straight against the live files; `samples/` are the same data as of today.
- Neither data repo has a `data/accounting.json` yet: §6 (migration) produces the MGS
  one; YourRights gets an empty-history one (start 2026-09-01, Ido & Omri 0.5/0.5).
- The collector session is done until cut-over (§7 steps 2–3); report back to the owner.
