# PROGRESS

## Phase A — Setup ✅ (2026-11-07)
CLAUDE.md, SPEC.md (from the brief + feed contract §10), this file.

## Phase B — App runs locally with the MGS numbers ✅ — waiting for the owner's review
Built:
- `projects.json` (both projects on the `local` source), `index.html`, `app.js`
  (pure balance computation + page + payment form), `apps-script/Code.gs` (written, not
  deployed), `tools/migrate_with_claude.py` → `data-local/mgs/accounting.json`
  (25 history rows, 3 settlements), `data-local/yourrights/accounting.json`,
  `tools/report.js`, `tests/compute.test.js` (8 tests, pass).

Checked (`node tools/report.js mgs 3.0129 --only=Anthropic`, tests, headless Chromium):

| | Brief | App |
|---|---|---|
| MGS Anthropic since 2026-06-07 | $1,020.51 / 35 rows | $1,020.51 / 35 rows |
| After Guy's last payment (Aug 13) | $347.31 / 7 rows | $347.31 / 7 rows (same dates) |
| Guy's half of that | $173.66 | $173.66 |
| History rows also in the feed | 16, same ref & amount | 16 deduplicated (feed wins); 9 pre-June rows shown under "Not split" |

With every vendor split (`vendors: "*"`, the real MGS page, rate ₪3.0129) and
`needs_parsing` rows left out (O2): headline $364.99 over 9 rows (+ Render $5.68,
Green API $12.00); total since Jun 7 $1,038.19 over 37 rows (footer); Guy owes $184.20
(Claude-only view: $175.36), of which $1.70 is FX carry-over (SPEC O4). 5 MGS rows are
shown but not summed (4 without an amount, 019 SMS ₪29.50 awaiting parsing).
YourRights: $419.09 over 11 rows, Omri owes $209.54.

Not verifiable here: the live rate (this sandbox can't reach Frankfurter/api.github.com;
the page fell back to ₪3.0129), the `github` source, and the Apps Script.

## Phase C — Live wiring (owner's go 2026-11-08) — in progress
- ✅ `idododan/yourrights-expenses`: `data/accounting.json` committed (342b283);
  `projects.json` → yourrights reads from `github`.
- ⏳ `idododan/mgs-expenses`: `data/accounting.json` not committed yet (this session
  could not attach the repo). Needs the two Frankfurter rates first (`--rate`).
- ⏳ Apps Script: owner's token (expected 2026-11-09) + PINs, deploy, URL in
  `projects.json`.
- ⏳ GitHub Pages for `idododan/expense-split` (needs the code on `main`).
- Not verifiable from this sandbox: api.github.com reads from the page.

## Phase C plan (as agreed)
Owner: fine-grained token + PINs in Script Properties, deploy the Apps Script, put its
URL in `projects.json`. Then commit the two `accounting.json` files to the data repos,
switch both projects to `source: "github"`, enable Pages. Open points: SPEC §10 O3. O1, O2, O4 decided 2026-11-08.
At cut-over: re-run the migration with `--rate 2026-07-14=… --rate 2026-08-13=…`
(Frankfurter rates for those dates) before committing MGS `accounting.json`.
