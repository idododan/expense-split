# expense-split

One static page that shows, for one project at a time, who owes whom on shared expenses,
and lets the owner record a partner's payment. `?project=mgs`, `?project=yourrights`.

- Receipts come from each project's own data repo (`data/expenses.json`, written by the
  expenses collector). Partners, payments and history live next to it in
  `data/accounting.json`, which this app appends to through a small Google Apps Script.
- No framework, no build: `index.html` + `app.js` + `projects.json`, served by GitHub Pages.

Start with `CLAUDE.md` (how to work here) and `SPEC.md` (the contract). The original brief
is in `handover/`. Progress and open items: `PROGRESS.md`.

```sh
python3 -m http.server 8765
open "http://localhost:8765/?project=mgs&source=local"
node tools/test_ledger.js && node tools/test_apps_script.js
```
