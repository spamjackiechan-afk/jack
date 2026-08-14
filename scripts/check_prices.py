"""
PeptideOutpost price checker.

Visits each vendor's real product pages and tries to read the current price
off the page. Writes results to data/live_prices.json.

IMPORTANT — before turning this on for a vendor:
  1. Check https://<vendor-domain>/robots.txt yourself in a browser.
  2. If it disallows crawling generally (Disallow: /) or disallows the
     specific /product/ or /shop/ paths, DO NOT add that vendor below.
     Ask them directly for a price feed instead, or keep updating manually.
  3. UltraLife is already known to disallow this — do not add them here.

This script is intentionally conservative: if it can't find a confident
price on a page, it leaves that item out of the results rather than
guessing. A missing price is a visible gap you can check by hand; a wrong
price silently shown as real data is worse.
"""

import json
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# One entry per vendor. Only add a vendor here after checking their
# robots.txt yourself — see the warning above.
VENDORS = {
    "Improved Peptides": {
        "robots_checked_by": "Jackson, 2026-08-13",
        "robots_allows": True,   # confirmed: robots.txt only blocks wp-admin, logs, cart-tracking
                                  # URLs, and /wp-json/ipp/ — /product/ and /shop/ are wide open
    },
    "Royal Peptides": {
        "robots_checked_by": None,
        "robots_allows": None,
    },
}

HEADERS = {
    "User-Agent": "PeptideOutpost-PriceChecker/1.0 (independent comparison site; contact: <your email>)"
}

PRICE_PATTERN = re.compile(r"\$\s?([\d,]+\.?\d*)")


def extract_price(html: str) -> float | None:
    """
    Try a few common price-markup patterns (WooCommerce is the most common
    platform among these vendors). Returns None if nothing confident is found
    — callers should treat None as "couldn't verify", not "price is zero".
    """
    soup = BeautifulSoup(html, "html.parser")

    # WooCommerce standard markup
    price_el = soup.select_one(".woocommerce-Price-amount, p.price ins .amount, p.price .amount")
    if price_el:
        match = PRICE_PATTERN.search(price_el.get_text())
        if match:
            return float(match.group(1).replace(",", ""))

    # schema.org microdata, used by some storefronts
    price_meta = soup.select_one('[itemprop="price"]')
    if price_meta:
        val = price_meta.get("content") or price_meta.get_text()
        match = PRICE_PATTERN.search(val) or re.search(r"[\d.]+", val or "")
        if match:
            return float(match.group(0).replace(",", "").lstrip("$"))

    return None


def check_product(url: str) -> dict:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except requests.RequestException as e:
        return {"url": url, "price": None, "error": str(e)}

    price = extract_price(resp.text)
    if price is None:
        return {"url": url, "price": None, "error": "no confident price match — page structure may have changed"}
    return {"url": url, "price": price, "error": None}


def main():
    catalog_path = Path(__file__).parent.parent / "data" / "product_urls.json"
    if not catalog_path.exists():
        print(f"Missing {catalog_path} — run build_url_list.py first, or see README.")
        sys.exit(1)

    catalog = json.loads(catalog_path.read_text())
    results = {}
    errors = []

    for vendor, cfg in VENDORS.items():
        if cfg.get("robots_allows") is not True:
            print(f"Skipping {vendor} — robots.txt not confirmed allowed (see VENDORS config at top of this file).")
            continue

        vendor_items = catalog.get(vendor, {})
        print(f"Checking {len(vendor_items)} {vendor} products...")
        for item_key, url in vendor_items.items():
            result = check_product(url)
            results.setdefault(vendor, {})[item_key] = result
            if result["error"]:
                errors.append(f"{vendor} — {item_key}: {result['error']}")
            time.sleep(2)  # be a polite, slow crawler — no need to hammer their server

    out_path = Path(__file__).parent.parent / "data" / "live_prices.json"
    out_path.parent.mkdir(exist_ok=True)
    out_path.write_text(json.dumps({
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "results": results,
    }, indent=2))

    print(f"\nDone. {sum(len(v) for v in results.values())} prices checked.")
    if errors:
        print(f"\n{len(errors)} items could not be verified:")
        for e in errors:
            print(f"  - {e}")


if __name__ == "__main__":
    main()
