# Progress

Phases from `handover/BRIEF.md` §8. Newest first. Each entry: what was done, how it was
checked, what is open.

## ⏸ Waiting for the owner: deploy and push (2026-11-08)

The app runs locally with the MGS numbers from the brief. The owner decided `SPEC.md` §9
items 0–2 (per-day rates, USD, shared receipts in full). Left for the owner: deploy the
Apps Script (steps in the `apps-script/Code.gs` header), put its URL in `projects.json`,
say when to merge and push `main` to `idododan/expense-split`, enable GitHub Pages, then
the cut-over of the brief's §7. Nothing has been pushed yet.

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
