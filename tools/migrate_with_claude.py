#!/usr/bin/env python3
"""Turn the old "Claude Spending" page into the MGS accounting.json (SPEC.md §7).

    python3 tools/migrate_with_claude.py handover/samples/with-claude/spending.html local/mgs/accounting.json

Reads ALL_RECEIPTS, SETTLEMENTS and ACCOUNTING_START out of the page's script with
regexes (the page is a frozen artefact, so the shapes are fixed). Every ALL_RECEIPTS
row becomes a history row (pre-start rows included: shown, not split). Each settlement
keeps its original currency: `ils: 347` → 347 ILS, `amount: 65.39` → 65.39 USD.
"""
import argparse
import datetime as dt
import json
import re
import sys

ROW_RE = re.compile(
    r'\{\s*date:\s*"(?P<date>\d{4}-\d{2}-\d{2})",\s*amount:\s*(?P<amount>[\d.]+),'
    r'\s*desc:\s*"(?P<desc>[^"]*)",\s*receipt:\s*"(?P<receipt>[^"]+)",'
    r'\s*paidBy:\s*"(?P<paid_by>[^"]+)"\s*\}')
SETTLE_RE = re.compile(
    r'\{\s*date:\s*"(?P<date>\d{4}-\d{2}-\d{2})",\s*by:\s*"(?P<by>[^"]+)",'
    r'\s*(?P<kind>amount|ils):\s*(?P<value>[\d.]+),\s*note:\s*"(?P<note>[^"]*)"\s*\}')


def block(src, name):
    m = re.search(r'var\s+%s\s*=\s*\[(.*?)\];' % name, src, re.S)
    if not m:
        sys.exit("%s not found in the page" % name)
    return m.group(1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("page", help="spending.html")
    ap.add_argument("out", help="accounting.json to write")
    ap.add_argument("--project", default="mgs")
    ap.add_argument("--currency", default="USD", help="display currency")
    ap.add_argument("--partners", nargs="+", default=["Ido:0.5", "Guy:0.5"], metavar="NAME:SHARE")
    ap.add_argument("--paid-by", default="Ido")
    args = ap.parse_args()

    src = open(args.page, encoding="utf-8").read()

    m = re.search(r'var\s+ACCOUNTING_START\s*=\s*"(\d{4}-\d{2}-\d{2})"', src)
    if not m:
        sys.exit("ACCOUNTING_START not found")
    start = m.group(1)

    history = []
    for r in ROW_RE.finditer(block(src, "ALL_RECEIPTS")):
        history.append({
            "date": r["date"],
            "merchant": "Anthropic",
            "description": r["desc"].replace("\\u2013", "–"),
            "amount": float(r["amount"]),
            "currency": "USD",
            "reference": r["receipt"],
            "paid_by": r["paid_by"],
        })
    history.sort(key=lambda h: (h["date"], h["reference"]))

    settlements = []
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for s in SETTLE_RE.finditer(block(src, "SETTLEMENTS")):
        n = sum(1 for x in settlements if x["date"] == s["date"]) + 1
        settlements.append({
            "id": "p-%s-%d" % (s["date"], n),
            "date": s["date"],
            "paid_by": s["by"],
            "amount": float(s["value"]),
            "currency": "ILS" if s["kind"] == "ils" else "USD",
            "note": s["note"],
            "added_at": now,
            "added_by": "migration",
        })
    settlements.sort(key=lambda x: x["date"])

    partners = []
    for p in args.partners:
        name, share = p.rsplit(":", 1)
        partners.append({"name": name, "share": float(share)})
    if abs(sum(p["share"] for p in partners) - 1) > 1e-9:
        sys.exit("shares must sum to 1")

    out = {
        "schema": 1,
        "project": args.project,
        "accounting_start": start,
        "display_currency": args.currency,
        "paid_by": args.paid_by,
        "partners": partners,
        "vendors": "*",
        "history": history,
        "settlements": settlements,
        "adjustments": [],
        "excluded": [],
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")

    counted = [h for h in history if h["date"] >= start]
    print("wrote %s: %d history rows (%d from %s, $%.2f), %d settlements, start %s" % (
        args.out, len(history), len(counted), start, sum(h["amount"] for h in counted),
        len(settlements), start))


if __name__ == "__main__":
    main()
