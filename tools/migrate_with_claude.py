#!/usr/bin/env python3
"""Turn the frozen MGS page (With-Claude spending.html) into the MGS accounting.json.

Usage: python3 tools/migrate_with_claude.py path/to/spending.html > accounting.json

Reads ALL_RECEIPTS, ACCOUNTING_START and SETTLEMENTS from the page source. Every
receipt becomes a history row (pre-start rows included: they stay visible, unsplit).
Fails loudly if the page does not look as expected, so nothing is silently dropped.
"""
import json
import re
import sys


def block(src, name):
    m = re.search(r"var %s\s*=\s*\[(.*?)\];" % name, src, re.S)
    if not m:
        sys.exit("migrate: %s not found" % name)
    return m.group(1)


def objects(body):
    out = []
    for obj in re.findall(r"\{([^{}]*)\}", body):
        fields = {}
        for key, sval, nval in re.findall(
                r'(\w+)\s*:\s*(?:"((?:[^"\\]|\\.)*)"|(-?[0-9.]+))', obj):
            fields[key] = sval if nval == "" else float(nval)
        out.append(fields)
    return out


def main(path):
    src = open(path, encoding="utf-8").read()
    start = re.search(r'var ACCOUNTING_START\s*=\s*"(\d{4}-\d\d-\d\d)"', src)
    if not start:
        sys.exit("migrate: ACCOUNTING_START not found")

    receipts = objects(block(src, "ALL_RECEIPTS"))
    settlements = objects(block(src, "SETTLEMENTS"))

    history = []
    for r in receipts:
        for k in ("date", "amount", "desc", "receipt"):
            if k not in r:
                sys.exit("migrate: receipt without %s: %r" % (k, r))
        history.append({
            "date": r["date"],
            "merchant": "Anthropic",
            "reference": r["receipt"],
            "amount": round(r["amount"], 2),
            "currency": r.get("cur", "USD"),
            "desc": r["desc"],
            "paid_by": r.get("paidBy", "Ido"),
        })
    history.sort(key=lambda h: (h["date"], h["reference"]))
    if len({h["reference"] for h in history}) != len(history):
        sys.exit("migrate: duplicate receipt numbers in ALL_RECEIPTS")

    pays = []
    for s in settlements:
        if "ils" in s:
            amount, cur = s["ils"], "ILS"
        elif "amount" in s:
            amount, cur = s["amount"], "USD"
        else:
            sys.exit("migrate: settlement without amount: %r" % s)
        pays.append({
            "date": s["date"],
            "by": s["by"],
            "amount": round(amount, 2),
            "currency": cur,
            "note": s.get("note", ""),
        })
    pays.sort(key=lambda p: p["date"])

    out = {
        "project": "mgs",
        "display_currency": "USD",
        "accounting_start": start.group(1),
        "paid_by": "Ido",
        "partners": [{"name": "Ido", "share": 0.5}, {"name": "Guy", "share": 0.5}],
        "vendors": "*",
        "excluded": [],
        "history": history,
        "settlements": pays,
        "adjustments": [],
        "migrated_from": "idododan/With-Claude spending.html",
    }
    json.dump(out, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    print("migrate: %d history rows, %d settlements, start %s"
          % (len(history), len(pays), out["accounting_start"]), file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
