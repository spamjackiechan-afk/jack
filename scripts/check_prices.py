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
import os
import re
import sys
import time
from html import unescape
from pathlib import Path
from urllib.parse import parse_qs, urlsplit, urlunsplit

import requests
from bs4 import BeautifulSoup

# One entry per vendor. Only add a vendor here after checking their
# robots.txt yourself — see the warning above.
VENDORS = {
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
        "needs_browser": True,   # confirmed: a real browser-header request still doesn't get the
                                  # embedded price data — their site appears to only serve full
                                  # content to a real, JS-executing browser, not just a
                                  # browser-flavored plain HTTP request. Uses Playwright instead
                                  # of requests for this vendor only.
    },
    "Alpha Peptides": {
        "robots_checked_by": "Jackson, 2026-08-23",
        "robots_allows": True,   # confirmed: standard WooCommerce robots.txt — only blocks
                                  # /wp-admin/, wc-logs, transient files and add-to-cart query
                                  # params. /product/ pages are wide open. Affiliate partner.
        # Alpha's SiteGround Anti-Bot blocks GitHub's ever-changing IPs. Alpha
        # agreed (email, 2026-09-25) to allowlist a fixed IP, so their requests
        # go through our own small fixed-IP proxy server when the
        # ALPHA_PROXY_URL secret is set, and say who we are instead of
        # posing as Chrome. Without the secret they go direct, as before.
        "proxy_env": "ALPHA_PROXY_URL",
        "identify_as_bot": True,
    },
    "Licensed Peptides": {
        "robots_checked_by": "Jackson, 2026-08-25",
        "robots_allows": True,   # confirmed: unusually permissive robots.txt — blocks only two
                                  # paths, /product/ghk-cu-testing/ and /landing-page/. Verified
                                  # that none of our 17 product URLs touch either; our GHK-Cu
                                  # page is /product/ghk-cu/, a distinct page from the blocked
                                  # /product/ghk-cu-testing/. Affiliate partner.
    },
    "Midwest Peptide": {
        "robots_checked_by": "Jackson, 2026-09-15",
        "robots_allows": True,   # confirmed: robots.txt Allow: / with only /admin/, /account/,
                                  # /affiliate/, /checkout/, /cart, /api/ blocked — /products/
                                  # pages are wide open. Affiliate partner.
    },
    "American Peptides": {
        "robots_checked_by": "Jackson, 2026-09-15",
        "robots_allows": True,   # confirmed: robots.txt Allow: /; only Disallow /api/, /catalog/
                                  # — /products/ pages are wide open. Host: www.americanpeptides.us.
                                  # Domain lock: americanpeptides.us only (NOT buyamericanpeptides.com /
                                  # Legion, NOT americanpeptide.com). Affiliate partner (probation).
    },
    "Offline Peptides": {
        "robots_checked_by": "research 2026-09-15 (AffiliateWP onboarding)",
        "robots_allows": True,   # confirmed: User-agent * Disallow only wc-logs/uploads, add-to-cart
                                  # querystrings, /wp-admin/ (Allow admin-ajax); Yoast empty Disallow.
                                  # /product/, /shop/, /coa/ not disallowed. Affiliate partner.
    },
    "Orbitrex Peptide": {
        "robots_checked_by": "research 2026-09-15 (GoAffPro onboarding)",
        "robots_allows": True,   # confirmed: User-agent * Disallow only /api/, account/cart/checkout,
                                  # portal/affiliate-portal, wp-admin/login/json/xmlrpc, and a few
                                  # querystrings — /product/ and /shop/ pages are not disallowed.
    },
}

HEADERS = {
    # Presented as an ordinary browser request. Some vendor sites appear to
    # treat simple automated clients differently from real browsers (Core
    # Peptides returns 403 outright; Purity Peptides silently omits the
    # embedded price data) even though their robots.txt permits this kind
    # of access. This doesn't change what we request or how often — same
    # URLs, same 2-second delay between requests, same robots.txt checks —
    # just how the request identifies itself.
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}

# Used instead of HEADERS for vendors that asked to recognise us (see
# "identify_as_bot" in VENDORS), so they can spot the checker in their logs.
# User-Agent value asked for by SiteGround (Alpha email, 30 Sept 2026): the
# old "Mozilla/5.0 (compatible; ...)" wrapper tripped a SiteGround security
# rule (the 403s), so the value is now fully custom.
BOT_HEADERS = {
    **HEADERS,
    "User-Agent": "DiscountPeptides-PriceChecker/1.0; +https://discountspeptides.com/about",
}


def vendor_request_options(cfg: dict) -> tuple[dict, dict | None]:
    """Headers and (optional) proxy settings for one vendor."""
    headers = BOT_HEADERS if cfg.get("identify_as_bot") else HEADERS
    proxy_url = os.environ.get(cfg["proxy_env"], "").strip() if cfg.get("proxy_env") else ""
    proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None
    return headers, proxies


BOT_CHALLENGE_ERROR = "blocked by the vendor's bot protection (captcha page) — not a page change"


def is_bot_challenge(status: int, headers, html: str) -> bool:
    """True when the vendor served a bot check instead of the product page.

    SiteGround's Anti-Bot AI answers with HTTP 202, an "sg-captcha: challenge"
    header and a redirect to /.well-known/sgcaptcha/. Reporting this as a
    block (instead of "page structure may have changed") keeps the error
    list honest about what actually went wrong.
    """
    head = (html or "")[:20000].lower()
    return (
        status == 202
        or "sg-captcha" in {k.lower() for k in (headers or {})}
        or "/.well-known/sgcaptcha" in head
        or "sgcaptcha" in head
    )


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


def extract_regular_price(html: str, current: float | None) -> float | None:
    """The pre-sale price, where a vendor is showing one.

    WooCommerce renders a sale as <del>old</del><ins>new</ins>, and also spells
    it out in text ("Original price was: $37.58"). Only returns a figure that is
    genuinely higher than the current price, so a mis-parse can't invent a
    discount that isn't there.
    """
    # American Peptides (Next.js): sale shown as
    #   <div class="pdp-price">$48.00 <small class="pdp-price-was">$60.00</small>
    m = re.search(
        r'class=["\']pdp-price["\'][^>]*>\s*\$([0-9.]+)\s*<small class=["\']pdp-price-was["\']>\s*\$([0-9.]+)',
        html,
        re.I,
    )
    if m:
        now, was = float(m.group(1)), float(m.group(2))
        if current is None or abs(now - current) < 0.01:
            if was > now:
                return was

    candidates = []

    def _amount(fragment):
        # Strip tags and decode entities first: "&#36;31.00" must read as
        # $31.00, not 36. Must start with a digit: a bare "," (e.g. from inline
        # JS templates like <del>'+money(reg,u)+'</del>) would crash float().
        text = unescape(re.sub(r"<[^>]+>", "", fragment))
        found = re.search(r"\d[\d,]*\.?\d*", text)
        return float(found.group(0).replace(",", "")) if found else None

    # Only a <del> directly paired with an <ins> showing the current price is
    # this product's sale; other <del>s on the page (related products, promo
    # widgets) are not.
    for m in re.finditer(r"<del[^>]*>(.*?)</del>\s*<ins[^>]*>(.*?)</ins>", html, re.DOTALL | re.IGNORECASE):
        old, new = _amount(m.group(1)), _amount(m.group(2))
        if old is not None and new is not None and current is not None and abs(new - current) < 0.01:
            candidates.append(old)

    for m in re.finditer(r"Original price was:\s*\$?(\d[\d,]*\.?\d*)", html, re.IGNORECASE):
        candidates.append(float(m.group(1).replace(",", "")))

    if not candidates or current is None:
        return None
    # A sale means the old price is higher. Anything else is a parsing artefact.
    higher = [p for p in candidates if p > current]
    return min(higher) if higher else None


def extract_price(html: str) -> float | None:
    """
    Primary strategy: read the page's own structured data (JSON-LD), which
    most e-commerce sites include for Google/SEO purposes — confirmed
    working against real vendor page structures. This is far
    more reliable than guessing CSS class names, since it doesn't depend
    on a particular theme's markup.

    Falls back to common CSS price patterns if no structured data is found.
    Returns None if nothing confident is found — callers should treat None
    as "couldn't verify", not "price is zero".
    """
    # Prefer American Peptides visible PDP sale price when the page shows
    # both sale and was (pdp-price / pdp-price-was). JSON-LD on that site
    # still lists the pre-discount Offer price, which would hide the sale.
    m = re.search(
        r'class=["\']pdp-price["\'][^>]*>\s*\$([0-9.]+)\s*<small class=["\']pdp-price-was["\']>',
        html,
        re.I,
    )
    if m:
        return float(m.group(1))

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

    # Third fallback: some modern sites (e.g. Next.js apps, confirmed on
    # Purity Peptides) don't use JSON-LD or simple CSS at all — instead the
    # price lives inside a large embedded JSON payload the page uses to
    # render itself client-side, as a plain "price":94.99 field. This grabs
    # the FIRST such match in the raw page, which corresponds to the main
    # product — confirmed against a real page that this correctly skips
    # past a related/recommended product's price appearing later in the
    # same payload.
    raw_price_match = re.search(r'"price"\s*:\s*([\d.]+)', html)
    if raw_price_match:
        return float(raw_price_match.group(1))

    # Fourth fallback: WooCommerce *variable* products (multiple vial sizes or
    # pack quantities behind a selector) often carry no single price in the
    # static HTML at all — the selected variant's price is written by JS after
    # load. What they do reliably expose is a range in the Twitter card meta,
    # e.g. content="$76.99 - $839.94". The low end of that range is the base
    # single-unit price, which is what this site compares. Confirmed against
    # Licensed Peptides' real product pages.
    tw = soup.select_one('meta[name="twitter:data1"]')
    if tw and tw.get("content"):
        match = re.search(r"[\d,]+\.?\d*", tw["content"])
        if match:
            return float(match.group(0).replace(",", ""))

    return None


def variant_id_from_url(url: str) -> str | None:
    """Shopify-style ?variant=ID pins a listing to one size of a multi-size
    product page (e.g. American Peptides' Semaglutide page sells 5/10/20/30/50 mg
    and the page itself always shows the first size)."""
    vals = parse_qs(urlsplit(url).query).get("variant") or []
    return vals[0] if vals and vals[0].isdigit() else None


def _jsonld_offer_prices_by_sku(html: str) -> dict:
    out = {}
    for m in re.finditer(r"<script[^>]*application/ld\+json[^>]*>(.*?)</script>", html, re.DOTALL | re.IGNORECASE):
        try:
            stack = [json.loads(m.group(1))]
        except ValueError:
            continue
        while stack:
            node = stack.pop()
            if isinstance(node, list):
                stack.extend(node)
            elif isinstance(node, dict):
                if node.get("@type") == "Offer" and node.get("sku") and isinstance(node.get("price"), (int, float, str)):
                    try:
                        out[str(node["sku"])] = float(node["price"])
                    except ValueError:
                        pass
                stack.extend(node.values())
    return out


def extract_variant_price(html: str, variant_id: str) -> tuple:
    """(price, regular_price) of ONE variant, read from the product data the page
    embeds (American Peptides: a flat {"id":"<id>","title":"10 mg","sku":...,
    "price":90,...} object in the Next.js payload). Trusted only when the page's
    JSON-LD Offer for the same SKU shows the same price, which rules out a stray
    id match or a cents-vs-dollars payload. Returns (None, None) otherwise; the
    default variant's price is never used as a stand-in."""
    text = html.replace('\\"', '"')
    offers = None
    for m in re.finditer(r'\{"id":"?%s"?[,}]' % variant_id, text):
        obj = text[m.start():text.find("}", m.start()) + 1]
        price, sku = re.search(r'"price":"?(\d+(?:\.\d+)?)[",}]', obj), re.search(r'"sku":"([^"]+)"', obj)
        if not (price and sku):
            continue
        price = float(price.group(1))
        offers = _jsonld_offer_prices_by_sku(html) if offers is None else offers
        if sku.group(1) not in offers or abs(offers[sku.group(1)] - price) > 0.005:
            continue
        was = re.search(r'"compare_?at_?price":"?(\d+(?:\.\d+)?)', obj, re.IGNORECASE)
        return price, (float(was.group(1)) if was and float(was.group(1)) > price else None)
    return None, None


def _shopify_variant_price(url: str, variant_id: str, headers: dict, proxies: dict | None) -> tuple:
    """Fallback for stock Shopify storefronts: /products/<handle>.js lists every
    variant with price / compare_at_price in cents."""
    parts = urlsplit(url)
    try:
        resp = requests.get(urlunsplit((parts.scheme, parts.netloc, parts.path.rstrip("/") + ".js", "", "")),
                            headers=headers, proxies=proxies, timeout=20)
        resp.raise_for_status()
        variants = resp.json().get("variants") or []
    except (requests.RequestException, ValueError, AttributeError):
        return None, None
    for v in variants:
        if str(v.get("id")) == variant_id and isinstance(v.get("price"), int):
            price, was = v["price"] / 100, v.get("compare_at_price")
            return price, (was / 100 if isinstance(was, int) and was / 100 > price else None)
    return None, None


def check_product(url: str, headers: dict = HEADERS, proxies: dict | None = None) -> dict:
    try:
        resp = requests.get(url, headers=headers, proxies=proxies, timeout=20)
        if is_bot_challenge(resp.status_code, resp.headers, resp.text):
            return {"url": url, "price": None, "error": BOT_CHALLENGE_ERROR}
        resp.raise_for_status()
    except requests.RequestException as e:
        return {"url": url, "price": None, "error": str(e)}

    variant_id = variant_id_from_url(url)
    if variant_id:
        price, regular = extract_variant_price(resp.text, variant_id)
        if price is None:
            price, regular = _shopify_variant_price(url, variant_id, headers, proxies)
        if price is None:
            return {"url": url, "price": None, "error": f"variant {variant_id} price not found (default variant not used)"}
        return {"url": url, "price": price, "regular_price": regular, "error": None}

    price = extract_price(resp.text)
    if price is None:
        return {"url": url, "price": None, "error": "no confident price match — page structure may have changed"}
    return {"url": url, "price": price, "regular_price": extract_regular_price(resp.text, price), "error": None}


def check_product_with_browser(url: str, browser) -> dict:
    """
    Same idea as check_product(), but for vendors that only serve full,
    real content to an actual JS-executing browser (confirmed necessary
    for Purity Peptides — a plain requests.get(), even with realistic
    browser headers, doesn't get the embedded price data; a real browser
    does). Reuses extract_price() unchanged, since the underlying page
    content — once actually rendered — has the same structure either way.
    """
    page = browser.new_page()
    try:
        page.goto(url, timeout=20000, wait_until="networkidle")
        html = page.content()
    except Exception as e:
        return {"url": url, "price": None, "error": f"browser navigation failed: {e}"}
    finally:
        page.close()

    if is_bot_challenge(200, {}, html):
        return {"url": url, "price": None, "error": BOT_CHALLENGE_ERROR}
    variant_id = variant_id_from_url(url)
    if variant_id:
        price, regular = extract_variant_price(html, variant_id)
        if price is None:
            return {"url": url, "price": None, "error": f"variant {variant_id} price not found (default variant not used)"}
        return {"url": url, "price": price, "regular_price": regular, "error": None}
    price = extract_price(html)
    if price is None:
        return {"url": url, "price": None, "error": "no confident price match — page structure may have changed"}
    return {"url": url, "price": price, "regular_price": extract_regular_price(html, price), "error": None}


def apply_live_overlay(included: list, results: dict) -> int:
    """Reference implementation of how the homepage applies live_prices.json
    (index.html applyLiveOverlay — keep the two in step). Mutates `included`
    (the DATA.included list) in place and returns how many vendor prices it
    touched.

    * numeric price, vendor already on the row -> price updated, `lowest`
      recomputed. Offline Peptides never gets an onSale mark (standing rule).
    * price None (404, no confident parse, network error) -> that vendor is
      REMOVED from the row (prices, vendor_product_urls, onSale, liveVerified)
      and `lowest` recomputed; a row left with no vendors is dropped. Before
      this change a null was skipped, so the stale embedded price stayed up.
    * vendor not already on the row -> ignored (freshness overlay, not catalog).
    * safety: if every result for a vendor is None (site down / run blocked),
      nothing is cleared for that vendor.
    """
    touched = 0
    for vendor, items in (results or {}).items():
        vals = list((items or {}).values())
        unreachable = bool(vals) and all(r is None or r.get("price") is None for r in vals)
        for item_key, result in (items or {}).items():
            if result is None:
                continue
            price = result.get("price")
            if price is None and unreachable:
                continue
            parts = item_key.split(" | ")
            if len(parts) != 3:
                continue
            peptide, fmt, size = parts
            match = next((i for i in included if i.get("peptide") == peptide
                          and i.get("format") == fmt and i.get("size") == size), None)
            if match is None or vendor not in match.get("prices", {}):
                continue
            if price is None:
                match["prices"].pop(vendor, None)
                for field in ("vendor_product_urls", "onSale", "liveVerified"):
                    if isinstance(match.get(field), dict):
                        match[field].pop(vendor, None)
                if match["prices"]:
                    match["lowest"] = min(match["prices"].values())
                else:
                    included.remove(match)
                touched += 1
                continue
            match["prices"][vendor] = price
            match.setdefault("liveVerified", {})[vendor] = True
            match["lowest"] = min(match["prices"].values())
            regular = result.get("regular_price")
            if vendor != "Offline Peptides" and regular and regular > price:
                match.setdefault("onSale", {})[vendor] = regular
            touched += 1
    return touched


def main():
    catalog_path = Path(__file__).parent.parent / "data" / "product_urls.json"
    if not catalog_path.exists():
        print(f"Missing {catalog_path} — run build_url_list.py first, or see README.")
        sys.exit(1)

    catalog = json.loads(catalog_path.read_text())
    results = {}
    errors = []

    # Vendors that work fine with a plain HTTP request — the fast, simple
    # path, unchanged from before.
    fast_vendors = {v: c for v, c in VENDORS.items() if c.get("robots_allows") is True and not c.get("needs_browser")}
    # Vendors that need a real browser to get real content.
    browser_vendors = {v: c for v, c in VENDORS.items() if c.get("robots_allows") is True and c.get("needs_browser")}

    for vendor, cfg in {**fast_vendors}.items():
        vendor_items = catalog.get(vendor, {})
        headers, proxies = vendor_request_options(cfg)
        via = " via fixed-IP proxy" if proxies else ""
        print(f"Checking {len(vendor_items)} {vendor} products{via}...")
        for item_key, url in vendor_items.items():
            result = check_product(url, headers=headers, proxies=proxies)
            results.setdefault(vendor, {})[item_key] = result
            if result["error"]:
                errors.append(f"{vendor} — {item_key}: {result['error']}")
            time.sleep(2)  # be a polite, slow crawler — no need to hammer their server

    for vendor, cfg in {**VENDORS}.items():
        if cfg.get("robots_allows") is not True:
            print(f"Skipping {vendor} — robots.txt not confirmed allowed (see VENDORS config at top of this file).")

    if browser_vendors:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for vendor, cfg in browser_vendors.items():
                vendor_items = catalog.get(vendor, {})
                print(f"Checking {len(vendor_items)} {vendor} products (browser mode)...")
                for item_key, url in vendor_items.items():
                    result = check_product_with_browser(url, browser)
                    results.setdefault(vendor, {})[item_key] = result
                    if result["error"]:
                        errors.append(f"{vendor} — {item_key}: {result['error']}")
                    time.sleep(2)  # be a polite, slow crawler — no need to hammer their server
            browser.close()

    # Manual sale prices (e.g. a vendor's emailed code) survive the daily run.
    apply_price_overrides(results, catalog, Path(__file__).parent.parent / "data" / "price_overrides.json")

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


def apply_price_overrides(results: dict, catalog: dict, overrides_path: Path, now: float | None = None) -> list:
    """Merge data/price_overrides.json into `results` (in place).

    Each entry is  {vendor: {item_key: {"price", "regular_price", "expires", "source"}}}.
    An entry is used only if item_key exists in product_urls.json for that
    vendor (exact match; sale prices are never worked out for other sizes),
    price is a number, and `expires` (ISO time, e.g. 2026-10-05T04:59:00Z) is
    still in the future. Used entries replace the checked result and carry
    "override": true. Expired or invalid entries are skipped and logged.
    Top-level keys starting with "_" are notes and ignored. Returns the
    applied "vendor — item" names.
    """
    from datetime import datetime, timezone

    if not overrides_path.exists():
        return []
    try:
        overrides = json.loads(overrides_path.read_text())
    except ValueError as e:
        print(f"Price overrides: could not read {overrides_path.name} ({e}); none applied.")
        return []
    now = time.time() if now is None else now
    applied = []
    for vendor, items in overrides.items():
        if vendor.startswith("_") or not isinstance(items, dict):
            continue
        for item_key, ov in items.items():
            label = f"{vendor} — {item_key}"
            url = catalog.get(vendor, {}).get(item_key)
            if url is None:
                print(f"Price override skipped (not in product_urls.json): {label}")
                continue
            try:
                expires = datetime.strptime(ov["expires"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
            except (KeyError, TypeError, ValueError):
                print(f"Price override skipped (missing or bad 'expires', need YYYY-MM-DDTHH:MM:SSZ): {label}")
                continue
            if expires <= now:
                print(f"Price override skipped (expired {ov['expires']}): {label}")
                continue
            price, regular = ov.get("price"), ov.get("regular_price")
            if not isinstance(price, (int, float)) or isinstance(price, bool) or price <= 0 or (
                    regular is not None and (not isinstance(regular, (int, float)) or isinstance(regular, bool))):
                print(f"Price override skipped (price / regular_price must be numbers): {label}")
                continue
            results.setdefault(vendor, {})[item_key] = {
                "url": url,
                "price": float(price),
                "regular_price": float(regular) if regular is not None else None,
                "error": None,
                "override": True,
            }
            applied.append(label)
            print(f"Price override applied (until {ov['expires']}): {label}")
    return applied


if __name__ == "__main__":
    main()
