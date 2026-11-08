#!/usr/bin/env python3
"""The balance rule of SPEC.md §4 in Python, to cross-check app.js and the brief.

    python3 tools/check_balance.py mgs                      # every vendor, live-ish rate
    python3 tools/check_balance.py mgs --vendors Anthropic  # the old page's Claude-only view
    python3 tools/check_balance.py mgs --rate 3.6 --rows    # fixed USD/ILS rate, list rows

Reads local/<project>/expenses.json and accounting.json unless --dir is given.
"""
import argparse
import json
import os
import sys
import urllib.request

FALLBACK = {"USD": {"ILS": 3.0129}}  # last known, same as the old page


def rates_for(base, currencies, since, fixed=None):
    """{cur: number | {"latest": n, "by_date": {date: n}}} — units of cur per 1 base (SPEC §5)"""
    rates = {base: 1.0}
    need = sorted(c for c in currencies if c and c != base)
    if not need:
        return rates, "no conversion needed"
    if fixed is not None:
        for c in need:
            rates[c] = fixed
        return rates, "fixed rate %s for every date" % fixed
    try:
        url = "https://api.frankfurter.dev/v1/%s..?base=%s&symbols=%s" % (since, base, ",".join(need))
        with urllib.request.urlopen(url, timeout=10) as r:
            d = json.load(r)
        for c in need:
            by_date = {day: v[c] for day, v in d["rates"].items() if c in v}
            rates[c] = {"latest": by_date[max(by_date)], "by_date": by_date}
        return rates, "Frankfurter daily %s..%s" % (d["start_date"], d["end_date"])
    except Exception as e:  # noqa: BLE001
        for c in need:
            rates[c] = FALLBACK.get(base, {}).get(c)
            if rates[c] is None:
                sys.exit("no rate for %s→%s (%s)" % (base, c, e))
        return rates, "offline fallback for every date (%s)" % e


def rate_on(rates, cur, date):
    r = rates[cur]
    if isinstance(r, (int, float)):
        return r
    days = [d for d in r["by_date"] if d <= date]
    return r["by_date"][max(days)] if days else r["by_date"][min(r["by_date"])]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project")
    ap.add_argument("--dir", help="folder with expenses.json and accounting.json (default local/<project>)")
    ap.add_argument("--vendors", nargs="*", help="override the accounting file's vendors list")
    ap.add_argument("--rate", type=float, help="fixed rate for every date (default: Frankfurter daily rates)")
    ap.add_argument("--rows", action="store_true", help="list the counted rows")
    args = ap.parse_args()

    d = args.dir or os.path.join("local", args.project)
    feed = json.load(open(os.path.join(d, "expenses.json"), encoding="utf-8"))
    acc = json.load(open(os.path.join(d, "accounting.json"), encoding="utf-8"))

    base = acc["display_currency"]
    start = acc["accounting_start"]
    vendors = args.vendors if args.vendors is not None else acc.get("vendors", "*")
    vendor_set = None if vendors == "*" else {v.lower() for v in vendors}
    excluded = set(acc.get("excluded", []))
    paid_by = acc["paid_by"]
    shares = {p["name"]: p["share"] for p in acc["partners"]}

    def norm(x):  # live files say `by` and may carry the rate of the payment day
        y = dict(x)
        y["paid_by"] = x.get("paid_by") or x.get("by")
        if y.get("rate") is None and isinstance(x.get("ils_per_usd"), (int, float)) \
                and x.get("currency") == "ILS" and base == "USD":
            y["rate"] = x["ils_per_usd"]
        return y
    settlements = [norm(s) for s in acc.get("settlements", [])]
    adjustments = [norm(a) for a in acc.get("adjustments", [])]

    # rows = feed ∪ history, deduplicated by reference (feed wins)
    feed_refs = {r["reference"] for r in feed["expenses"] if r.get("reference")}
    rows = []
    for r in feed["expenses"]:
        rows.append(dict(r, _src="feed"))
    for h in acc.get("history", []):
        if h.get("reference") and h["reference"] in feed_refs:
            continue
        rows.append(dict(h, id="hist:" + str(h.get("reference")), _src="history"))

    currencies = {r.get("currency") for r in rows} | {s["currency"] for s in settlements} \
        | {a["currency"] for a in adjustments}
    since = min([start] + [r["date"] for r in rows] + [s["date"] for s in settlements] + [a["date"] for a in adjustments])
    rates, rate_src = rates_for(base, currencies, since, args.rate)

    def value(amount, cur, date):
        return amount / rate_on(rates, cur or base, date)

    def value_of(x):  # settlement / adjustment: its own recorded rate wins, else the rate of its date
        if x.get("rate") and x["currency"] != base:
            return x["amount"] / x["rate"]
        return value(x["amount"], x["currency"], x["date"])

    def counted(r):
        return (r["date"] >= start and (vendor_set is None or r["merchant"].lower() in vendor_set)
                and r["id"] not in excluded and r.get("amount") is not None)

    cnt = sorted((r for r in rows if counted(r)), key=lambda r: r["date"])
    total = sum(value(r["amount"], r.get("currency"), r["date"]) for r in cnt)

    others = [p for p in shares if p != paid_by]
    last_pay = max((s["date"] for s in settlements if s["paid_by"] != paid_by), default=None)
    since_rows = [r for r in cnt if last_pay is None or r["date"] > last_pay]
    since_last = sum(value(r["amount"], r.get("currency"), r["date"]) for r in since_rows)

    sym = {"USD": "$", "ILS": "₪", "EUR": "€"}.get(base, base + " ")
    print("project %s · start %s · vendors %s · %s" % (args.project, start, vendors, rate_src))
    print("counted rows: %d   total: %s%.2f" % (len(cnt), sym, total))
    print("since last payment (%s): %d rows, %s%.2f" % (last_pay or "start", len(since_rows), sym, since_last))
    for p in others:
        paid = sum(value_of(s) for s in settlements if s["paid_by"] == p)
        adj = sum(value_of(a) for a in adjustments if a.get("partner") == p)
        share = total * shares[p]
        bal = share - paid + adj
        carried = bal - since_last * shares[p]
        fixed = sum(1 for s in settlements if s["paid_by"] == p and s.get("rate"))
        print("%s: share %s%.2f − paid %s%.2f %s adj %s%.2f = balance %s%.2f  (carried over %s%.2f; %d payment(s) at recorded rates)" % (
            p, sym, share, sym, paid, "+" if adj >= 0 else "−", sym, abs(adj), sym, bal, sym, carried, fixed))
    skipped = [r for r in rows if not counted(r)]
    print("not counted: %d (%d before start, %d no amount, %d excluded, %d other vendor)" % (
        len(skipped), sum(1 for r in skipped if r["date"] < start),
        sum(1 for r in skipped if r.get("amount") is None), sum(1 for r in skipped if r["id"] in excluded),
        sum(1 for r in skipped if vendor_set is not None and r["merchant"].lower() not in vendor_set)))
    if args.rows:
        for r in cnt:
            print("  %s %-12s %9.2f %-3s %s%.2f  %s" % (r["date"], r["merchant"][:12], r["amount"],
                  r.get("currency") or base, sym, value(r["amount"], r.get("currency"), r["date"]), r["_src"]))


if __name__ == "__main__":
    main()
