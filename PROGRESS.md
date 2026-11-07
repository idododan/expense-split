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

With every vendor split (`vendors: "*"`, the real MGS page, rate ₪3.0129):
headline $374.78 over 10 rows (+ Render $5.68, Green API $12.00, 019 SMS ₪29.50 ≈ $9.79);
total since Jun 7 $1,047.98 over 38 rows; Guy owes $189.09 (Claude-only view: $175.36),
of which $1.70 is FX carry-over (SPEC O4). 4 MGS rows have no amount yet (shown, not summed).
YourRights: $428.88 over 12 rows, Omri owes $214.44.

Not verifiable here: the live rate (this sandbox can't reach Frankfurter/api.github.com;
the page fell back to ₪3.0129), the `github` source, and the Apps Script.

## Next — Phase C (on the owner's go)
Owner: fine-grained token + PINs in Script Properties, deploy the Apps Script, put its
URL in `projects.json`. Then commit the two `accounting.json` files to the data repos,
switch both projects to `source: "github"`, enable Pages. Open points: SPEC §10 O1–O4.
