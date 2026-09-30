#!/usr/bin/env python3
"""Keep the public vendor config and its page embeds in sync.

vendor_config.json is public (it is served at /vendor_config.json and embedded
in index.html and suppliers.html), so it must hold only the fields the site
code reads. Internal notes (commission, cookie length, programme terms,
guidelines_notes, last_checked, _readme, _field_guide) live in the private
vendor notes file, not in this repo. See docs/site-changes.md.

What this does:
  1. reads vendor_config.json,
  2. keeps only PUBLIC_FIELDS for each vendor (key order and vendor order are
     preserved; anything else is dropped and listed on stdout),
  3. writes vendor_config.json back (2-space indent, \\uXXXX escapes, same as before),
  4. rewrites ONLY the `const VENDOR_CONFIG = ...;` line in index.html and
     suppliers.html with the same data as compact JSON.

Usage:  python scripts/sync_vendor_config.py
Running it twice changes nothing the second time.
"""
import json
import os
import sys
from collections import OrderedDict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CONFIG = os.path.join(ROOT, "vendor_config.json")
PAGES = ["index.html", "suppliers.html"]
PREFIX = "const VENDOR_CONFIG = "

# Fields read by index.html / suppliers.html (and the fallback script).
PUBLIC_FIELDS = [
    "status", "site_url", "tracking_type", "affiliate_link_base",
    "affiliate_path_suffix", "promo_code", "payment_methods", "payment_note",
    "shipping_info", "shipping_payment_researched", "testing_methods",
    "testing_lab", "testing_standard", "testing_note", "testing_researched",
    # Not read by any site code today. Kept public until Jackson decides
    # whether it stays (it is a quality rating, not a secret).
    "testing_tier",
]


def public_config(cfg):
    out, dropped = OrderedDict(), set()
    for vendor, fields in cfg.items():
        if vendor.startswith("_"):
            dropped.add(vendor)
            continue
        out[vendor] = OrderedDict((k, v) for k, v in fields.items() if k in PUBLIC_FIELDS)
        dropped.update(k for k in fields if k not in PUBLIC_FIELDS)
    return out, sorted(dropped)


def rewrite_embed(path, line_text):
    with open(path, encoding="utf-8", newline="") as f:
        text = f.read()
    lines = text.split("\n")
    hits = [i for i, l in enumerate(lines) if l.startswith(PREFIX)]
    if len(hits) != 1:
        sys.exit(f"{os.path.basename(path)}: expected exactly one line starting with "
                 f"{PREFIX!r}, found {len(hits)}. Nothing written.")
    if lines[hits[0]] == line_text:
        return False
    lines[hits[0]] = line_text
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write("\n".join(lines))
    return True


def main():
    with open(CONFIG, encoding="utf-8") as f:
        cfg = json.load(f, object_pairs_hook=OrderedDict)
    pub, dropped = public_config(cfg)
    if dropped:
        print("dropped from the public config (keep these in the private notes file):",
              ", ".join(dropped))

    new_file = json.dumps(pub, indent=2, ensure_ascii=True) + "\n"
    with open(CONFIG, encoding="utf-8") as f:
        changed = f.read() != new_file
    if changed:
        with open(CONFIG, "w", encoding="utf-8") as f:
            f.write(new_file)
    print(("updated" if changed else "unchanged") + ": vendor_config.json")

    line = PREFIX + json.dumps(pub, separators=(",", ":"), ensure_ascii=True) + ";"
    for page in PAGES:
        changed = rewrite_embed(os.path.join(ROOT, page), line)
        print(("updated" if changed else "unchanged") + f": {page} (VENDOR_CONFIG line)")


if __name__ == "__main__":
    main()
