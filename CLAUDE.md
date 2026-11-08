# expense-split — working agreement

## What this is

One static web app, deployed once on GitHub Pages, that shows for one project at a time
who owes whom on shared expenses: `?project=mgs`, `?project=yourrights`, and future
projects. It reads two files from that project's own data repo and writes payments back
through a small Google Apps Script. `SPEC.md` is the contract; `handover/` is the
original brief and must not be edited except to record owner decisions.

## How to work here

- **Branch first.** Never commit on `main`. Work on `build/*` or `fix/*` branches;
  `main` is what GitHub Pages serves.
- **Plan before building, stop at phase boundaries.** Each phase ends with a commit and
  a `PROGRESS.md` entry; stop for the owner's review where `PROGRESS.md` says so.
- **Conventional commits:** `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`.
- **No framework, no build step.** Plain `index.html` + `app.js` + `projects.json`.
  Vanilla JS that runs from `file://` or any static server. No bundler, no npm.
- **Data is not code.** The collector owns `data/expenses.json` in each data repo; this
  app never writes it. This app owns `data/accounting.json`; the collector never writes
  it. Fix wrong numbers in `accounting.json` (history, exclusions, adjustments), never by
  editing a feed.
- **Secrets never enter this repo or the page.** The GitHub token and the project PINs
  live only in the Apps Script's Script Properties (`GITHUB_TOKEN`, `PIN_<project>`).
- **Don't touch the old page.** `handover/samples/with-claude/` is a frozen copy of the
  page this app replaces; the live copy in `idododan/With-Claude` stays up until the
  owner's cut-over.

## Run and check locally

```sh
python3 -m http.server 8765              # from the repo root (8000 is taken by the collector panel)
open "http://localhost:8765/?project=mgs&source=local"
node tools/test_ledger.js                # the balance rule in app.js (49 checks)
node tools/test_apps_script.js           # the payments script with a fake GitHub (85 checks)
python3 tools/check_balance.py mgs       # same rule in Python, prints the MGS numbers
```

`source=local` reads `local/<project>/{expenses,accounting}.json`; without it the page
reads the live data repos through `api.github.com`. Regenerate the local accounting
files with the tools in `tools/` (see `SPEC.md` §7), never by hand.

## Parity numbers (from the brief, 2026-11-08)

MGS, Anthropic only, since 2026-06-07: **$1,020.51 over 35 rows**; after Guy's last
payment (2026-08-13): **$347.31 over 7 rows**. `check_balance.py mgs --vendors Anthropic`
must print these.

## Layout

```
index.html app.js projects.json   the app
apps-script/Code.gs               payments web app (paste into Apps Script, deploy)
tools/                            migration, accounting-file generator, checks
local/<project>/                  dev data: feed copy + generated accounting.json
handover/                         brief, feed contract, samples (read-only)
SPEC.md PROGRESS.md               contract and phase log
```
