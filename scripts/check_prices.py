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
        "robots_checked_by": "Jackson, 2026-08-14",
        "robots_allows": True,   # confirmed: robots.txt only blocks wp-admin, cart/checkout/account,
                                  # filter/sort query params, and plugin dirs — /shop/ is wide open
    },
    "BioIntegrity Research": {
        "robots_checked_by": "Jackson, 2026-08-18",
        "robots_allows": True,   # confirmed: robots.txt only blocks /cart, /checkout, /api/ —
                                  # /compounds/ pages are wide open. Site explicitly names ClaudeBot
                                  # with Allow: / too.
    },
    "Koi Peptides": {
        "robots_checked_by": "Jackson, 2026-08-18",
        "robots_allows": True,   # confirmed: blocks named AI crawlers (ClaudeBot, GPTBot, etc.) by
                                  # name, but general "*" rule (which our own-named script falls
                                  # under) is Allow: / — only admin/cart/checkout/account/sorting
                                  # paths blocked, no product pages. Only 2/4 products have a known
                                  # URL right now — the other 2 need URLs collected before they'll
                                  # show up in results.
    },
    "Core Peptides": {
        "robots_checked_by": "Jackson, 2026-08-18",
        "robots_allows": True,   # confirmed: robots.txt only blocks /wp-admin/, /feed/, /tmp/ —
                                  # /peptides/ pages are wide open. All 15/15 products have a
                                  # known URL.
    },
    "Purity Peptides": {
        "robots_checked_by": "Jackson, 2026-08-18",
        "robots_allows": True,   # confirmed: blocks named AI crawlers (ClaudeBot, GPTBot, etc.) by
                                  # name via the newer Content-Signal format, but general "*" rule
                                  # (which our own-named script falls under) is Allow: / — only
                                  # /api/, /checkout, /order-confirmation/ blocked, no product
                                  # pages. 42/48 products have a known URL; 6 need confirming
                                  # (a few possible size mismatches, a few URLs with no size
                                  # in them at all).
    },
}

HEADERS = {
    "User-Agent": "PeptideOutpost-PriceChecker/1.0 (independent comparison site; contact: <your email>)"
}

PRICE_PATTERN = re.compile(r"\$\s?([\d,]+\.?\d*)")


def _find_price_in_jsonld(node):
    """Recursively search a parsed JSON-LD object for a price value —
    checks both a simple Offer's "price" and an AggregateOffer's "lowPrice"
    (used by products with multiple size/dose options, where there's no
    single fixed price, just a starting price)."""
    if isinstance(node, dict):
        offers = node.get("offers")
        if isinstance(offers, dict):
            for key in ("price", "lowPrice"):
                if key in offers:
                    try:
                        return float(offers[key])
                    except (TypeError, ValueError):
                        pass
        if isinstance(offers, list):
            for o in offers:
                if isinstance(o, dict):
                    for key in ("price", "lowPrice"):
                        if key in o:
                            try:
                                return float(o[key])
                            except (TypeError, ValueError):
                                pass
        graph = node.get("@graph")
        if isinstance(graph, list):
            for item in graph:
                result = _find_price_in_jsonld(item)
                if result is not None:
                    return result
    elif isinstance(node, list):
        for item in node:
            result = _find_price_in_jsonld(item)
            if result is not None:
                return result
    return None


def extract_price(html: str) -> float | None:
    """
    Primary strategy: read the page's own structured data (JSON-LD), which
    most e-commerce sites include for Google/SEO purposes — confirmed
    working against Improved Peptides' real page structure. This is far
    more reliable than guessing CSS class names, since it doesn't depend
    on a particular theme's markup.

    Falls back to common CSS price patterns if no structured data is found.
    Returns None if nothing confident is found — callers should treat None
    as "couldn't verify", not "price is zero".
    """
    soup = BeautifulSoup(html, "html.parser")

    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        price = _find_price_in_jsonld(data)
        if price is not None:
            return price

    # Fallback: common CSS price patterns (WooCommerce, schema.org microdata)
    price_el = soup.select_one(".woocommerce-Price-amount, p.price ins .amount, p.price .amount")
    if price_el:
        match = PRICE_PATTERN.search(price_el.get_text())
        if match:
            return float(match.group(1).replace(",", ""))

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
