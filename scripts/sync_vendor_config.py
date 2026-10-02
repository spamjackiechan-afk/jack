#!/usr/bin/env python3
"""Keep the embedded data in index.html / suppliers.html in sync with the JSON files.

The pages embed data lines on purpose (the page still works if a fetch
fails, and the fallback script relies on them). They are generated from:

  vendor_config.json   ->  `const VENDOR_CONFIG = ...;`  (compact, \\uXXXX escapes)
  data/catalog.json    ->  `const DATA = ...;`            (compact, UTF-8 as-is)
  data/vendor_sales.json -> `const VENDOR_SALES = ...;`   (suppliers.html only;
                            vendor-run sale promos, shown as a "Vendor sale"
                            row separate from our affiliate code)

Hidden vendors: a vendor with `"hidden": true` in vendor_config.json keeps
all its data (catalog.json, product_urls.json, its config and its VENDORS
entry in check_prices.py) but is left out of the `const DATA` line: its
prices and links are removed from every row, `lowest` is recomputed from the
remaining vendors, and rows left with no vendor are dropped. The price
checker skips hidden vendors too. To bring a vendor back, delete the flag
and run this script.

vendor_config.json is public (served at /vendor_config.json and embedded), so
it must hold only the fields the site code reads. Internal notes (commission,
cookie length, programme terms, guidelines_notes, last_checked, testing_tier,
testing_methods, testing_lab, testing_standard, testing_note, testing_researched,
_readme, _field_guide) live in the private vendor notes file, not in this repo.
See docs/site-changes.md.

Usage:
  python scripts/sync_vendor_config.py          # rewrite the embed lines
  python scripts/sync_vendor_config.py --check  # change nothing; exit 1 if
                                                # anything is out of sync
Syncing:
  1. reads vendor_config.json and keeps only PUBLIC_FIELDS for each vendor
     (key order and vendor order are preserved; anything else is dropped and
     listed on stdout), then writes it back (2-space indent, \\uXXXX escapes),
  2. rewrites ONLY the `const VENDOR_CONFIG = ...;` and `const DATA = ...;`
     lines in index.html and suppliers.html (DATA without hidden vendors, see
     above), plus the `const VENDOR_SALES = ...;` line in suppliers.html
     (from data/vendor_sales.json). Nothing else in the pages changes.
     data/catalog.json and data/vendor_sales.json themselves are never rewritten.
Running it twice changes nothing the second time. scripts/smoke_test.py runs
the --check and fails the site-smoke check if the embeds don't match.
"""
import json
import os
import sys
from collections import OrderedDict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CONFIG = "vendor_config.json"
CATALOG = os.path.join("data", "catalog.json")
SALES = os.path.join("data", "vendor_sales.json")
PAGES = ["index.html", "suppliers.html"]
PREFIX = "const VENDOR_CONFIG = "
DATA_PREFIX = "const DATA = "
SALES_PREFIX = "const VENDOR_SALES = "

# Fields read by index.html / suppliers.html (and the fallback script).
PUBLIC_FIELDS = [
    "status", "site_url", "tracking_type", "affiliate_link_base",
    "affiliate_path_suffix", "promo_code", "payment_methods", "payment_note",
    "shipping_info", "shipping_payment_researched", "hidden",
    # Currency / shipping region (any vendor): `currency` is an ISO 4217 code,
    # USD when absent. `ships_to` is a region code (e.g. "CA") and
    # `ships_to_label` the neutral text shown next to that vendor's prices and
    # on its Suppliers card; absent = no label. Prices are never converted:
    # non-USD prices are shown with their currency and kept out of every
    # lowest-price / price-sort computation.
    "currency", "ships_to", "ships_to_label",
]

# Per-vendor fields on a catalog row that must go when the vendor is hidden.
ROW_VENDOR_FIELDS = ("prices", "vendor_product_urls", "onSale", "liveVerified")


def public_config(cfg):
    out, dropped = OrderedDict(), set()
    for vendor, fields in cfg.items():
        if vendor.startswith("_"):
            dropped.add(vendor)
            continue
        out[vendor] = OrderedDict((k, v) for k, v in fields.items() if k in PUBLIC_FIELDS)
        dropped.update(k for k in fields if k not in PUBLIC_FIELDS)
    return out, sorted(dropped)


def hidden_vendors(cfg):
    """Vendors marked `"hidden": true` in vendor_config.json."""
    return {v for v, f in cfg.items() if not v.startswith("_") and isinstance(f, dict) and f.get("hidden") is True}


def non_usd_vendors(cfg):
    """Vendor -> currency for every vendor whose `currency` is set and isn't USD."""
    out = {}
    for v, f in cfg.items():
        if v.startswith("_") or not isinstance(f, dict):
            continue
        cur = str(f.get("currency") or "USD").upper()
        if cur != "USD":
            out[v] = cur
    return out


def usd_lowest(prices, non_usd):
    """Lowest price among USD vendors only; None when the row has no USD price.
    Non-USD prices are never converted and never count as the lowest."""
    vals = [p for v, p in (prices or {}).items() if v not in non_usd]
    return min(vals) if vals else None


def visible_catalog(catalog, hidden, non_usd=None):
    """catalog.json as the pages should embed it: hidden vendors removed from
    every row, `lowest` recomputed on rows that lost one, rows left with no
    vendor dropped. On rows carrying a non-USD vendor, `lowest` is the lowest
    USD price (None if there is none). Other rows are left exactly as they are."""
    non_usd = non_usd or {}
    if not hidden and not non_usd:
        return catalog
    out = OrderedDict(catalog)
    for section in ("included", "excluded"):
        rows = catalog.get(section)
        if not isinstance(rows, list):
            continue
        kept = []
        for row in rows:
            prices = row.get("prices") or {}
            has_hidden = any(v in prices for v in hidden)
            has_non_usd = any(v in prices for v in non_usd)
            if not has_hidden and not has_non_usd:
                kept.append(row)
                continue
            row = OrderedDict(row)
            for field in ROW_VENDOR_FIELDS:
                if has_hidden and isinstance(row.get(field), dict):
                    row[field] = OrderedDict((k, v) for k, v in row[field].items() if k not in hidden)
            if not row["prices"]:
                continue
            row["lowest"] = usd_lowest(row["prices"], non_usd)
            kept.append(row)
        out[section] = kept
    return out


def load_json(root, rel):
    with open(os.path.join(root, rel), encoding="utf-8") as f:
        return json.load(f, object_pairs_hook=OrderedDict)


def expected_lines(root):
    """The public vendor_config.json text and the embed lines each page should carry.

    Returns (config_text, lines_by_page, dropped) where lines_by_page maps
    page -> {prefix: full line}. suppliers.html additionally carries
    const VENDOR_SALES from data/vendor_sales.json (the vendor's own sale
    promos, shown separately from our affiliate code); keys starting with
    "_" (e.g. _readme) are not embedded."""
    pub, dropped = public_config(load_json(root, CONFIG))
    config_text = json.dumps(pub, indent=2, ensure_ascii=True) + "\n"
    data = visible_catalog(load_json(root, CATALOG), hidden_vendors(pub), non_usd_vendors(pub))
    sales = OrderedDict((k, v) for k, v in load_json(root, SALES).items() if not k.startswith("_"))
    shared = {
        PREFIX: PREFIX + json.dumps(pub, separators=(",", ":"), ensure_ascii=True) + ";",
        DATA_PREFIX: DATA_PREFIX + json.dumps(data, separators=(",", ":"), ensure_ascii=False) + ";",
    }
    lines_by_page = {page: dict(shared) for page in PAGES}
    lines_by_page["suppliers.html"][SALES_PREFIX] = (
        SALES_PREFIX + json.dumps(sales, separators=(",", ":"), ensure_ascii=False) + ";"
    )
    return config_text, lines_by_page, dropped


def read_page(root, page):
    with open(os.path.join(root, page), encoding="utf-8", newline="") as f:
        return f.read().split("\n")


def find_line(lines, prefix, page):
    hits = [i for i, l in enumerate(lines) if l.startswith(prefix)]
    if len(hits) != 1:
        raise ValueError(f"{page}: expected exactly one line starting with {prefix!r}, found {len(hits)}")
    return hits[0]


def check(root=ROOT):
    """Return a list of problems (empty = everything in sync). Changes nothing."""
    problems = []
    try:
        config_text, want, dropped = expected_lines(root)
    except (OSError, ValueError) as e:
        return [f"embeds: cannot read the JSON sources: {e}"]
    with open(os.path.join(root, CONFIG), encoding="utf-8") as f:
        if f.read() != config_text:
            extra = f" (non-public fields: {', '.join(dropped)})" if dropped else ""
            problems.append(f"{CONFIG} is not in synced form{extra}; run python scripts/sync_vendor_config.py")
    for page in PAGES:
        try:
            lines = read_page(root, page)
            for prefix, line in want[page].items():
                if lines[find_line(lines, prefix, page)] != line:
                    src = {DATA_PREFIX: CATALOG, SALES_PREFIX: SALES}.get(prefix, CONFIG)
                    problems.append(f"{page}: the `{prefix.strip()}` line doesn't match {src}; "
                                    "edit the JSON and run python scripts/sync_vendor_config.py")
        except (OSError, ValueError) as e:
            problems.append(str(e))
    return problems


def sync(root=ROOT):
    config_text, want, dropped = expected_lines(root)
    if dropped:
        print("dropped from the public config (keep these in the private notes file):",
              ", ".join(dropped))
    path = os.path.join(root, CONFIG)
    with open(path, encoding="utf-8") as f:
        changed = f.read() != config_text
    if changed:
        with open(path, "w", encoding="utf-8") as f:
            f.write(config_text)
    print(("updated" if changed else "unchanged") + f": {CONFIG}")

    for page in PAGES:
        lines = read_page(root, page)
        idx = {prefix: find_line(lines, prefix, page) for prefix in want[page]}  # all found before writing
        changed = [p.strip() for p, i in idx.items() if lines[i] != want[page][p]]
        for prefix, i in idx.items():
            lines[i] = want[page][prefix]
        if changed:
            with open(os.path.join(root, page), "w", encoding="utf-8", newline="") as f:
                f.write("\n".join(lines))
        print(f"{'updated' if changed else 'unchanged'}: {page}" + (f" ({', '.join(changed)} line)" if changed else ""))


def main():
    if "--check" in sys.argv[1:]:
        problems = check()
        if problems:
            print("OUT OF SYNC:\n  " + "\n  ".join(problems))
            sys.exit(1)
        print("OK: embeds match vendor_config.json, data/catalog.json and data/vendor_sales.json")
        return
    try:
        sync()
    except ValueError as e:
        sys.exit(f"{e}. Nothing written.")


if __name__ == "__main__":
    main()
