# Progress

Phases from `handover/BRIEF.md` §8. Newest first. Each entry: what was done, how it was
checked, what is open.

## ⏸ Live on GitHub Pages; waiting for the owner (2026-11-08)

https://idododan.github.io/expense-split/?project=mgs is live from `main` and reads the
data repos. The Apps Script is deployed and its URL is in `projects.json`; from here it
answered ping for both projects and refused a wrong PIN on the POST path. Left for the
owner:

1. The first real payment from the page (end-to-end test of browser → Apps Script →
   GitHub). A ₪1 `test` row can be removed afterwards by editing `data/accounting.json`
   in `idododan/mgs-expenses`.
2. Revert the ₪1 test payment (one Terminal line, given in the chat), or leave it.
3. Cut-over (brief §7): compare with the old page, send Guy and Omri the URLs, leave the
   old page up.

## Review follow-up — the card's shekels (2026-11-08, later)

- Owner: "my rate is the conversion of the credit card company", with eight statement
  lines. Formula found exact: USD × representative rate of the next day × 1.03. Page and
  checker now keep the ledger in ILS (`projects.json` overrides `display_currency`),
  convert dollar receipts with that formula (ECB rate standing in for the BoI rate, ≤0.3%
  apart), payments without fee. Headline swapped: the balance is the big number.
- Apps Script: display currency from `projects.json`, `rate_base` written next to
  `rate`. The deployed version still works with the page (its rows are read as a USD→ILS
  pair); redeploying is optional.
- Checked: 73 + 90 checks; eight statement lines reproduce to the agora (one by one
  agora off the card's rounding). MGS on 2026-11-08: Guy owes ₪627.82.
- Owner decided (2026-11-08): no access separation, each partner gets their own link
  (SPEC §9.3). The card's total moved back into the summary card at the owner's request.

## Review follow-up — rates per day (2026-11-08)

- Owner's principle: a partner's payment covers their share of what the owner actually
  paid. So receipts in other currencies now convert at the ECB rate of their own date
  (one Frankfurter series request per load), payments at their recorded rate or their
  date's rate; nothing drifts with today's rate. `tools/check_balance.py` does the same.
- Checked: `node tools/test_ledger.js` (56 checks); checker and app agree on the live
  series to the cent.

## Phase 4 — payments (2026-11-08)

- `apps-script/Code.gs`: PIN check, validation, append to `settlements`, commit through
  the Contents API with a 409 retry, Frankfurter rate of the payment date recorded on
  the row, `?action=ping`, JSONP fallback, `checkSetup()` for the editor.
- Checked: `node tools/test_apps_script.js` (85 checks) runs the script under Node with
  stubbed Apps Script services and a fake GitHub. Not yet deployed, so the browser →
  Apps Script → GitHub path is untested end to end; first real test is step 5 of the
  setup in `Code.gs`, then one payment on `?project=mgs`.
- Page: `+ Add payment` form (date, paid by, amount, currency, note, PIN remembered per
  project), survives the re-render when live rates arrive, `#pay` opens it directly.

## Phase 3 — the page (2026-11-08)

- `index.html`, `app.js`, `projects.json`. `computeLedger()` is SPEC §4 as a pure
  function; `tools/test_ledger.js` (49 checks) runs it against the live MGS data.
- Found on the way: both data repos already hold a `data/accounting.json` published by
  the collector session (MGS: the migrated old page with Guy's three payments, two of
  them with the shekel rate of their payment day). Their field names (`desc`, `by`,
  `ils_per_usd`) became the canonical shape; the app also reads the spec's spellings.
  `local/*/accounting.json` are copies of the live files.
- Checked against the brief: Anthropic since 2026-06-07 = $1,020.51 / 35 rows; since
  2026-08-13 = $347.31 / 7 rows. Guy's Claude-only balance with recorded rates:
  $173.74 (old page: $173.66). All vendors: $187.19, i.e. +$13.45 for Guy's half of
  Green API $12.00, Render $5.68 and 019 SMS ₪29.50 since June. YourRights: Omri owes
  $213.35 on 12 rows (rate of 2026-11-06).
- Rendered in headless Chrome: `?project=mgs` (live), `&source=local`, YourRights, the
  chooser, the form, 390 px width.

## Phase 2 — tools and local data (2026-11-08)

- `tools/migrate_with_claude.py` (with `--rates` reproduces the collector's file: same
  25 history rows, same rates 3.0139 and 2.981), `tools/new_accounting.py`,
  `tools/check_balance.py` (the rule in Python, prints the parity numbers).

## Phase 1 — working agreement and spec (2026-11-08)

- `CLAUDE.md`, `SPEC.md`, this file. Branch `build/app` from `main`.
