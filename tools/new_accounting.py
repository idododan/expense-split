#!/usr/bin/env python3
"""Write an empty-history accounting.json for a project (SPEC.md §3, §7).

    python3 tools/new_accounting.py --out local/yourrights/accounting.json \
        --project yourrights --start 2026-09-01 --partners Ido:0.5 Omri:0.5
"""
import argparse
import json
import sys


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, help="accounting.json to write")
    ap.add_argument("--project", required=True)
    ap.add_argument("--start", required=True, help="accounting start, YYYY-MM-DD")
    ap.add_argument("--partners", nargs="+", required=True, metavar="NAME:SHARE")
    ap.add_argument("--paid-by", default="Ido")
    ap.add_argument("--currency", default="USD")
    ap.add_argument("--vendors", nargs="*", default=None, help="merchants that count; default: all")
    args = ap.parse_args()

    partners = []
    for p in args.partners:
        name, share = p.rsplit(":", 1)
        partners.append({"name": name, "share": float(share)})
    if abs(sum(p["share"] for p in partners) - 1) > 1e-9:
        sys.exit("shares must sum to 1")
    if args.paid_by not in [p["name"] for p in partners]:
        sys.exit("--paid-by must be one of the partners")

    out = {
        "schema": 1,
        "project": args.project,
        "accounting_start": args.start,
        "display_currency": args.currency,
        "paid_by": args.paid_by,
        "partners": partners,
        "vendors": args.vendors if args.vendors else "*",
        "history": [],
        "settlements": [],
        "adjustments": [],
        "excluded": [],
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("wrote", args.out)


if __name__ == "__main__":
    main()
