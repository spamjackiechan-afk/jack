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
  * the suppliers panel / suppliers.html rendering < MIN_SUPPLIERS cards
Network errors (fonts, analytics, /api/* Cloudflare functions that don't exist
on a static server) are ignored on purpose.
"""
import argparse, functools, http.server, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright

MIN_CARDS = 50
MIN_VENDORS = 8
MIN_SUPPLIERS = 8


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
    httpd, base = serve(os.path.abspath(args.root))
    problems, notes = [], []

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

        # ---- Suppliers panel (on the homepage)
        try:
            page.click("#suppliersToggle", timeout=5000)
            page.wait_for_timeout(1500)
            n = page.locator("#supplierGrid .supplier-card").count()
            notes.append(f"suppliers panel: {n} cards")
            if n < MIN_SUPPLIERS:
                problems.append(f"suppliers panel: only {n} supplier cards (min {MIN_SUPPLIERS})")
        except Exception as e:
            problems.append(f"suppliers panel: could not exercise it: {str(e).splitlines()[0]}")
        page.close()

        # ---- suppliers.html
        page = open_page(browser, base + "/suppliers.html", problems, "suppliers.html")
        n = page.locator(".supplier-card").count()
        notes.append(f"suppliers.html: {n} cards")
        if n < MIN_SUPPLIERS:
            problems.append(f"suppliers.html: only {n} supplier cards (min {MIN_SUPPLIERS})")
        page.close()
        browser.close()
    httpd.shutdown()

    print("\n".join(notes))
    if problems:
        print("\nFAIL:\n  " + "\n  ".join(problems)); sys.exit(1)
    print("\nOK: site smoke test passed")


if __name__ == "__main__":
    main()
