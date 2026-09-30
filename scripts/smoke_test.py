#!/usr/bin/env python3
"""Site smoke test: renders the static site in headless Chromium and fails if
the homepage vendor list, the calculator, or the suppliers tools are broken.

Run locally:   pip install playwright && playwright install chromium
               python scripts/smoke_test.py              # serves the repo root
               python scripts/smoke_test.py --root DIR   # serves another copy
               python scripts/smoke_test.py --expect-fallback --root DIR
                 (DIR is a copy with the main render deliberately broken; passes
                  only if the render safety net still draws a usable list)

Fails on:
  * any uncaught JS error (pageerror) on index.html or suppliers.html
  * any console.error tagged [site-guard] (the in-page safety nets)
  * homepage < MIN_CARDS product cards, or < MIN_VENDORS distinct vendor names
  * the render safety net having kicked in (window.__DP_FALLBACK)
  * the calculator not producing a result for sample inputs
  * the homepage Suppliers nav item not linking to /suppliers
  * suppliers.html rendering < MIN_SUPPLIERS cards
  * the testing.html References news markup (NEWS_MARKERS) showing up on
    index.html or suppliers.html, in the raw file or the rendered page; it
    belongs on testing.html only (see docs/references-format.md)
  * testing.html rendering fewer than MIN_REFERENCES reference items
  * the embedded `const DATA` / `const VENDOR_CONFIG` lines in index.html or
    suppliers.html not exactly matching data/catalog.json / vendor_config.json
    (scripts/sync_vendor_config.py --check)
Network errors (fonts, analytics, /api/* Cloudflare functions that don't exist
on a static server) are ignored on purpose.
"""
import argparse, functools, http.server, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sync_vendor_config  # noqa: E402  (embed check)

MIN_CARDS = 50
MIN_VENDORS = 8
MIN_SUPPLIERS = 8
MIN_REFERENCES = 20
# Markup/copy used only by the testing.html References list. None of it may
# appear on the homepage or the suppliers page.
NEWS_MARKERS = ["news-tier", "news-item", "news-type", "peptide-chip",
                "data-tone", "tone-read", "Looks concerning", "Developing"]


def check_no_news(page, root, filename, problems):
    raw = open(os.path.join(root, filename), encoding="utf-8").read()
    rendered = page.content()
    for m in NEWS_MARKERS:
        if m in raw:
            problems.append(f"{filename}: contains testing-page news markup {m!r} (source file)")
        elif m in rendered:
            problems.append(f"{filename}: contains testing-page news markup {m!r} (rendered page)")


def serve(root):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a, **k):
            pass
    handler = functools.partial(Quiet, directory=root)
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


def open_page(browser, url, problems, label):
    page = browser.new_page(viewport={"width": 1366, "height": 900})
    page.set_default_timeout(8000)
    # Pre-dismiss the timed signup modal so it can't cover what we click.
    page.add_init_script("try{localStorage.setItem('dp_modal_seen','dismissed')}catch(e){}")
    page.on("pageerror", lambda e: problems.append(f"{label}: uncaught JS error: {e}"))
    page.on("console", lambda m: problems.append(f"{label}: {m.text}")
            if m.type == "error" and "[site-guard]" in m.text else None)
    page.goto(url, wait_until="load", timeout=60000)
    page.wait_for_timeout(2500)  # let live_prices overlay + deferred scripts settle
    return page


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.path.join(os.path.dirname(__file__), ".."))
    ap.add_argument("--expect-fallback", action="store_true")
    args = ap.parse_args()
    root = os.path.abspath(args.root)
    httpd, base = serve(root)
    problems, notes = [], []

    # ---- Embedded data lines must match their JSON sources
    embed_problems = sync_vendor_config.check(root)
    problems.extend(embed_problems)
    notes.append("embeds: " + ("OUT OF SYNC" if embed_problems else "DATA + VENDOR_CONFIG match the JSON files"))

    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ---- Homepage listings
        page = open_page(browser, base + "/index.html", problems, "index.html")
        cards = page.locator("#index .card").count()
        vendors = page.eval_on_selector_all(
            "#index .price-row .vendor",
            "els => [...new Set(els.map(e => (e.childNodes[0] && e.childNodes[0].textContent || '').split(' \u00b7 ')[0].trim()).filter(Boolean))].sort()")
        rows = page.locator("#index .price-row").count()
        fallback = page.evaluate("Boolean(window.__DP_FALLBACK)")
        notes.append(f"homepage: {cards} product cards, {rows} price rows, {len(vendors)} vendors, fallback={fallback}")
        notes.append("vendors: " + ", ".join(vendors))
        if cards < MIN_CARDS:
            problems.append(f"index.html: only {cards} product cards rendered (min {MIN_CARDS})")
        if len(vendors) < MIN_VENDORS:
            problems.append(f"index.html: only {len(vendors)} vendor names rendered (min {MIN_VENDORS}): {vendors}")

        if args.expect_fallback:
            browser.close(); httpd.shutdown()
            print("\n".join(notes))
            if not fallback:
                print("FAIL: expected the render safety net to kick in, but it did not"); sys.exit(1)
            real = [x for x in problems if "product cards" in x or "vendor names" in x]
            if real:
                print("FAIL: safety net ran but did not draw a usable list:\n  " + "\n  ".join(real)); sys.exit(1)
            print("OK: main render broken as intended and the safety net drew a usable list"); sys.exit(0)

        if fallback:
            problems.append("index.html: render safety net was used (main render failed); see errors above")

        # ---- Calculator (panel on the homepage)
        try:
            page.click("#calcToggle", timeout=5000)
            page.fill("#calcVial", "5"); page.fill("#calcWater", "2"); page.fill("#calcDose", "0.25")
            page.wait_for_timeout(300)
            units = page.inner_text("#calcUnits").strip()
            notes.append(f"calculator: 5mg / 2mL / 0.25mg -> {units!r}")
            if not page.is_visible("#calcSection") or units != "10 units":
                problems.append(f"calculator: expected '10 units' for 5mg/2mL/0.25mg, got {units!r}")
            page.click("#calcToggle", timeout=5000)
        except Exception as e:
            problems.append(f"calculator: could not exercise it: {str(e).splitlines()[0]}")

        # ---- Suppliers nav item (homepage) must link to the /suppliers page
        try:
            href = page.get_attribute("#suppliersLink", "href", timeout=5000)
            notes.append(f"suppliers nav link: {href!r}")
            if (href or "").rstrip("/") not in ("/suppliers", "suppliers", "/suppliers.html", "suppliers.html"):
                problems.append(f"suppliers nav link: expected /suppliers, got {href!r}")
        except Exception as e:
            problems.append(f"suppliers nav link: missing: {str(e).splitlines()[0]}")
        check_no_news(page, root, "index.html", problems)
        page.close()

        # ---- suppliers.html
        page = open_page(browser, base + "/suppliers.html", problems, "suppliers.html")
        n = page.locator(".supplier-card").count()
        notes.append(f"suppliers.html: {n} cards")
        if n < MIN_SUPPLIERS:
            problems.append(f"suppliers.html: only {n} supplier cards (min {MIN_SUPPLIERS})")
        check_no_news(page, root, "suppliers.html", problems)
        page.close()

        # ---- testing.html References (the only page allowed to carry them)
        page = open_page(browser, base + "/testing.html", problems, "testing.html")
        refs = page.locator("#refsNews .news-item").count()
        notes.append(f"testing.html: {refs} reference items")
        if refs < MIN_REFERENCES:
            problems.append(f"testing.html: only {refs} reference items (min {MIN_REFERENCES})")
        page.close()
        browser.close()
    httpd.shutdown()

    print("\n".join(notes))
    if problems:
        print("\nFAIL:\n  " + "\n  ".join(problems)); sys.exit(1)
    print("\nOK: site smoke test passed")


if __name__ == "__main__":
    main()
