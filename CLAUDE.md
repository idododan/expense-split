# CLAUDE.md — expense-split

## Intent

One static web app (GitHub Pages) that shows, for one project at a time
(`?project=mgs`, `?project=yourrights`, …), who owes whom. It reads the project's
receipts feed (`data/expenses.json`, written by the expenses-collector, never by us) and
the project's own accounting (`data/accounting.json`), both from the project's own
GitHub repo. It replaces the frozen MGS page in `idododan/With-Claude`.

`SPEC.md` is the source of truth for behaviour; `handover/` holds the original brief,
the feed contract and samples. Do not re-open the owner's decisions listed in SPEC §2.

## Rules

- **Branch first.** Never commit to `main`; work on a feature branch and push it.
- **Plan before building.** Write or update the plan (SPEC / PROGRESS) before a phase.
- **Stop for the owner's review at every phase boundary** (see SPEC §9). Do not start
  the next phase, deploy, or touch the data repos without the owner's go.
- **Keep `PROGRESS.md` current**: what is done, how it was checked, what is next/open.
- **Conventional commits** (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`).
- **No framework, no build step.** `index.html` + `app.js` + `projects.json` +
  `apps-script/Code.gs`. Plain ES5-ish browser JS; the balance logic in `app.js` is
  pure and also loads in Node for tests.
- **Never edit the feed.** Fix differences in `accounting.json` (history, exclusions,
  adjustments), never in `expenses.json`.
- **No secrets in this repo or the page.** The GitHub token and the PINs live only in
  the Apps Script's Script Properties.
- Never edit `handover/samples/with-claude/*` — it is the frozen reference.

## Layout

```
index.html            page (markup + styles, same look as the old MGS page)
app.js                loading, balance computation (pure), rendering, payment form
projects.json         project id → name, data repo, source (github | local)
apps-script/Code.gs   payment writer (Google Apps Script web app, JSONP)
tools/migrate_with_claude.py   old spending.html → MGS accounting.json
tools/report.js       prints the computed numbers for a project (Node)
tests/compute.test.js node --test, checks the brief's numbers
data-local/<id>/accounting.json  local accounting while the data repos have none
```

## Commands

```
python3 -m http.server 8000      # then http://localhost:8000/?project=mgs
node --test tests/*.test.js      # balance logic against the sample feed
node tools/report.js mgs [rate]  # numbers as the page computes them
python3 tools/migrate_with_claude.py handover/samples/with-claude/spending.html \
        > data-local/mgs/accounting.json
```
