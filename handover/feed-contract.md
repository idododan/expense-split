## 10. One file per project (2026-11-06)

Active whenever `config.toml` has `[[export_projects]]` tables; without them the
single combined snapshot of sections 1–9 is produced instead.

**Projects today:** `mgs` (MGS-Finance / TRS, with Guy) and `yourrights` (YourRights,
with Omri; counts from 2026-09-01).

```toml
[[export_projects]]
id = "mgs"                       # lower-case slug; "none" and "unassigned" are reserved
name = "MGS-Finance / TRS"
since = "2026-06-07"             # optional; default export_since
github_repo = "owner/repo"       # the project's OWN repo; unset = local file only
github_path = "data/expenses.json"
github_branch = "main"
```

**Which project gets a receipt.** In this order:

1. **The owner's override** for that receipt, kept in
   `receipts/.collector/project_overrides.json` as `{"<content_sha256>": ["mgs"]}`
   (a string or a list; `"none"` = no project). It beats every rule.
2. **A splitter**, for a vendor with `split`: one bill is divided by line (below).
3. **The vendor's `projects` list**: entries are tried in order and the first whose
   conditions all hold decides. `inbox` = the receiving account (for photo/SMS intake:
   the inboxes the same file was also seen in); `text` = regexes searched in the
   subject, merchant and file name, and only then in the receipt text; no condition =
   always. An entry names one `project` or several `projects` (the receipt is then
   exported to each, marked `shared`). `project = "none"` = not a shared expense.
   With several projects the entry may add `share = "even"`: the amount is divided
   equally (to the agora; spare agorot go to the first project named) and each row's
   `receipt_total` holds the whole receipt. Without it (`share = "full"`, the default)
   every project gets the full amount. When a project's `since` leaves only one
   project, that one carries the whole receipt.
4. Otherwise the receipt is **unassigned**: listed in
   `receipts/.collector/expenses-unassigned.json` with a reason, never published,
   until the owner decides.

A project's own `since` then applies, so a receipt can reach one project and not another.

| Vendor | `mgs` when | `yourrights` when |
|---|---|---|
| Anthropic (Claude) | always | always (both projects, `shared`) |
| Render | arrives in idodan@yahoo.com, or names the workspace "MGS Loan Apply" | arrives in idodan@gmail.com |
| Supabase | arrives in idodan@yahoo.com | arrives in idodan@gmail.com |
| Green API | arrives in idodan@yahoo.com, or says "MGS" | arrives in ido@productdesignchamps.com |
| GitHub | names the org `mgs-finance-apply` | names the user `idododan` |
| Google Workspace | invoice for mgs-finance.com | invoice for tagmulim.co.il (any other domain: `none`) |
| Calendly, YAMM | always | never |
| MyNames | never | always (assumption: the tagmulim.co.il domain) |
| 019 SMS | half of each receipt: both projects draw on one SMS pool under the parent 019 account and the receipt names neither user. All of it when the receipt names the user `mgsloanapply` | the other half (the user `idodan` cannot be told from the owner's mail name, so no rule singles it out) |
| 019 Mobile | the line ending 8680 (opened 13 Oct 2026, expected from the 19 Nov bill) | the line ending 4092 (the other three lines are private: `none`) |

**Splitters.** `split = "019mobile"` reads the per-subscriber table of the 019 Mobile
monthly bill (one bill covers every line of the account; amounts include VAT and add up
to the bill total). `lines = [{ number = "4092", project = "mgs" }, …]` maps a line to a
project (`"none"` for a private line). `number` is the full number or just its last
digits (4 or more, quoted): a line belongs to the entry its number ends with, the
longest entry winning, so a line can be listed before it first shows on a bill and the
config need not hold a full phone number. Each project gets **one row per bill** whose
`amount` is the sum of its lines and whose `receipt_total` is the whole bill. Lines with
no entry put the bill in the unassigned list (last 4 digits only). A bill whose lines do
not add up to its total is left unassigned with a warning. Other mail from the same
sender (welcome letters, codes) has no line table and is ignored. Phone numbers never
enter a published file.

**File contract.** Same rows as section 5, plus a `project` header and three fields:

```json
{
  "project": { "id": "mgs", "name": "MGS-Finance / TRS" },
  "generated_at": "2026-11-06T10:00:00Z",
  "expenses": [ { "…section 5 fields…": "…", "project": "mgs", "shared": false, "receipt_total": null } ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `project` | string | the project id (same for every row of the file) |
| `shared` | boolean | true when this same receipt is also in another project's file |
| `receipt_total` | number or null | null: `amount` is the **full** receipt amount (for a `shared` row that means the full amount is in both files, and how to divide it is the split apps' business). A number: `amount` is already this project's **part** and this is the whole receipt (a 019 Mobile line, or half of a 019 SMS receipt) |

`id` stays unique within a file; the same id can appear in two projects' files (a shared
receipt, or two portions of one bill). Privacy rules of section 4 apply to each file.

**Publishing.** Each project's file goes to its own `github_repo` (same Contents-API
flow as section 6, a commit only when `expenses` changed). A project without a repo is
written locally only: `receipts/.collector/expenses-<id>.json`. One project failing to
publish does not stop the others; the status line then starts with ⚠. The retired
combined target (`export_github_repo`) is ignored in this mode. Status line, e.g.
`export: mgs 37 → updated abc1234 · yourrights 10 → unchanged · 6 need a project`.

**Guarantees to the split app** (2026-11-07, so a partner balance kept on its side is
never disturbed by the feed):

- `id` never changes for the same receipt file; `reference` identifies the vendor's
  document, so one charge keeps one reference even if it is filed twice.
- A project's `since` is only ever moved earlier, never later: rows do not vanish from
  the past.
- `amount` is the amount actually paid. Totals already filed can be re-read with
  `collector --reparse [--match REGEX] [--apply]` when the parser improves (a dry run
  lists `old → new` per record; `--apply` writes the ledger and refreshes the local
  files).
- The feed carries receipts only. Partner payments, settlements, the accounting start,
  history from before the feed and manual adjustments belong to the split app's own
  file; the collector never writes it.

**Not built yet:** assigning a project from the panel (today: the overrides file), and
recognising invoice + receipt pairs of one charge.
