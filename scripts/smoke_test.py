#!/usr/bin/env python3
"""Site smoke test: renders the static site in headless Chromium and fails if
the homepage vendor list or the suppliers tools are broken, or if any dosing /
reconstitution calculator comes back.

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
  * calculator.html existing again, or any public page containing calculator
    markup or a /calculator link. The reconstitution/dosing calculator was
    removed on purpose (FDA cites these as evidence of human use); it must
    not come back
  * the homepage Suppliers nav item not linking to /suppliers
  * suppliers.html rendering < MIN_SUPPLIERS cards
  * a vendor count on index.html, suppliers.html or about.html ("13 vendors",
    "13 suppliers", title/meta tags, the About stats strip), in the raw file or
    the rendered page, that differs from the number of distinct vendors with
    listings in the homepage DATA
  * the retired References news markup (NEWS_MARKERS, formerly testing.html)
    showing up on index.html or suppliers.html, raw or rendered
  * testing.html reappearing, or the Research nav link not pointing to
    https://peptidehealthdigest.vercel.app/ with target=_blank rel=noopener
  * the embedded `const DATA` / `const VENDOR_CONFIG` lines in index.html or
    suppliers.html not exactly matching data/catalog.json / vendor_config.json
    (scripts/sync_vendor_config.py --check)
  * a non-USD vendor's price (vendor_config `currency`, USD when absent)
    shown without its currency prefix (CA$ for CAD, else "CODE 0.00"), a USD
    price shown with anything but "$", a non-USD row marked as the lowest
    price, a vendor's `ships_to_label` missing from its price rows, or (price
    sort low->high and high->low) a card with no USD price placed before a
    card that has one. Rows are checked in the fallback list too.
  * Google Analytics (ga-consent.js): a public page (index, about, suppliers,
    privacy, research) not loading it; admin-reviews.html or functions/ loading
    it; the Measurement ID appearing in any file other than ga-consent.js;
    privacy.html missing or not in sitemap.xml; on a first visit, the cookie
    banner not showing or any request going to Google's analytics hosts
    before Accept (also checked after Decline)
  * public sales (guest view; /api/member-sales is not reachable on a static
    server, so member-sales.js falls back to data/vendor_sales.json): the sales
    bar missing, the old "join free" teaser showing, an excluded vendor
    (Offline, Licensed, AFA, RPL, Synthrolab) in the sales, observed
    sales without badges/Sales strip, or the suppliers page not showing every
    currently-live vendor sale; a vendor sale code in the raw index.html or
    suppliers.html
Network errors (fonts, analytics, /api/* Cloudflare functions that don't exist
on a static server) are ignored on purpose.
"""
import argparse, functools, http.server, json, os, re, socketserver, sys, threading
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sync_vendor_config  # noqa: E402  (embed check)

MIN_CARDS = 50
MIN_VENDORS = 8
MIN_SUPPLIERS = 8
RESEARCH_URL = "https://peptidehealthdigest.vercel.app/"
# Markup/copy formerly used only by the testing.html References list (retired). None of it may
# appear on the homepage or the suppliers page.
NEWS_MARKERS = ["news-tier", "news-item", "news-type", "peptide-chip",
                "data-tone", "tone-read", "Looks concerning", "Developing"]
# Google Analytics. The ID is split here so this file doesn't count as a
# second copy of it; it may appear only in ga-consent.js.
GA_FILE = "ga-consent.js"
GA_ID = "G-" + "CYYYPQ5ZDX"
GA_PAGES = ["index.html", "about.html", "suppliers.html", "privacy.html", "research.html"]
GA_HOSTS = ("googletagmanager.com", "google-analytics.com")


def check_ga_static(root, problems, notes):
    tag = f'src="/{GA_FILE}"'
    for f in GA_PAGES:
        path = os.path.join(root, f)
        if not os.path.exists(path):
            problems.append(f"{f}: missing")
        elif tag not in open(path, encoding="utf-8").read():
            problems.append(f"{f}: does not load /{GA_FILE}")
    if GA_FILE in open(os.path.join(root, "admin-reviews.html"), encoding="utf-8").read():
        problems.append(f"admin-reviews.html: must not load {GA_FILE}")
    holders = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules", "__pycache__")]
        for name in filenames:
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, root)
            try:
                data = open(path, "rb").read()
            except OSError:
                continue
            if rel.startswith("functions" + os.sep) and (GA_FILE.encode() in data or b"googletagmanager" in data):
                problems.append(f"{rel}: functions/ must not load Google Analytics")
            if GA_ID.encode() in data:
                holders.append(rel)
    if holders != [GA_FILE]:
        problems.append(f"Measurement ID must appear only in {GA_FILE}; found in: {sorted(holders) or 'nowhere'}")
    sitemap = open(os.path.join(root, "sitemap.xml"), encoding="utf-8").read()
    if "<loc>https://discountspeptides.com/privacy</loc>" not in sitemap:
        problems.append("sitemap.xml: /privacy is missing")
    notes.append(f"GA: {GA_FILE} on {len(GA_PAGES)} public pages, ID only in {', '.join(holders)}")


def check_ga_first_visit(browser, base, problems, notes):
    # Fresh browser profile: no saved choice, so the banner must show and
    # nothing may be requested from Google until Accept.
    ctx = browser.new_context(viewport={"width": 375, "height": 812})
    page = ctx.new_page()
    page.set_default_timeout(8000)
    google = []
    page.on("request", lambda r: google.append(r.url) if any(h in r.url for h in GA_HOSTS) else None)
    page.on("pageerror", lambda e: problems.append(f"GA first visit: uncaught JS error: {e}"))
    try:
        page.goto(base + "/index.html", wait_until="load", timeout=60000)
        page.wait_for_timeout(1500)
        if not page.is_visible("#dp-consent"):
            problems.append("GA first visit: cookie banner not shown")
        else:
            page.click("#dp-consent [data-dp-choice='denied']")
            page.wait_for_timeout(300)
            if page.is_visible("#dp-consent"):
                problems.append("GA: Decline did not hide the banner")
            page.reload(wait_until="load")
            page.wait_for_timeout(1000)
            if page.is_visible("#dp-consent"):
                problems.append("GA: banner came back after Decline + reload")
    except Exception as e:
        problems.append(f"GA first visit: could not exercise the banner: {str(e).splitlines()[0]}")
    if google:
        problems.append(f"GA: requests to Google before Accept: {google[:3]}")
    notes.append(f"GA first visit: banner + Decline checked, {len(google)} Google analytics requests")
    ctx.close()


def check_no_news(page, root, filename, problems):
    raw = open(os.path.join(root, filename), encoding="utf-8").read()
    rendered = page.content()
    for m in NEWS_MARKERS:
        if m in raw:
            problems.append(f"{filename}: contains testing-page news markup {m!r} (source file)")
        elif m in rendered:
            problems.append(f"{filename}: contains testing-page news markup {m!r} (rendered page)")


# "13 vendors", "13 suppliers", "Across 13 Vendors", "13\nSUPPLIERS" (About
# stats strip). Per-product counts on the homepage cards ("4 vendors compared")
# are not site-wide claims and are skipped, and so is the daily price-drop
# banner ("8 prices cut across 2 vendors"), which counts vendors with cuts.
NUMBER_WORDS = {w: i for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen "
    "fourteen fifteen sixteen seventeen eighteen nineteen twenty".split())}
VENDOR_COUNT_RE = re.compile(
    r"(?<!across\s)\b(\d+|" + "|".join(NUMBER_WORDS) + r")\s+(?:peptide\s+)?(?:vendors|suppliers)\b(?!\s+compared)",
    re.I)


def data_vendor_count(root):
    """Distinct vendors with at least one listing in the homepage DATA line."""
    for line in open(os.path.join(root, "index.html"), encoding="utf-8"):
        if line.startswith("const DATA = "):
            data = json.loads(line[len("const DATA = "):].rstrip().rstrip(";"))
            return len({v for row in data.get("included", []) for v in row.get("prices", {})})
    return None


def check_vendor_count(text, where, expected, problems):
    for m in VENDOR_COUNT_RE.finditer(text):
        word = m.group(1).lower()
        n = NUMBER_WORDS[word] if word in NUMBER_WORDS else int(word)
        if n != expected:
            problems.append(f"{where}: says {' '.join(m.group(0).split())!r} but the data has {expected} vendors")


def check_vendor_count_raw(root, filename, expected, problems):
    # The embedded data lines are data, not copy; skip them.
    raw = "".join(l for l in open(os.path.join(root, filename), encoding="utf-8")
                  if not l.startswith(("const DATA = ", "const VENDOR_CONFIG = ")))
    check_vendor_count(raw, f"{filename} (source file)", expected, problems)


SALE_VENDORS = {"American Peptides", "Peptide Titans", "True Peptides", "Veratis Bio", "Ride the Tide Peptides", "Midwest Peptide", "Orbitrex Peptide"}


def live_vendor_sales(root):
    """Vendor sales that should be visible right now (same rules as the pages)."""
    import datetime as dt
    sales = json.load(open(os.path.join(root, "data", "vendor_sales.json"), encoding="utf-8"))
    now = dt.datetime.now(dt.timezone.utc)
    parse = lambda s: dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    out = []
    for vendor, items in sales.items():
        if vendor.startswith("_") or vendor not in SALE_VENDORS:
            continue
        for s_ in items or []:
            if vendor == "Ride the Tide Peptides" and re.search(r"bogo|buy\s*one,?\s*get\s*one", f"{s_.get('code') or ''} {s_.get('gives') or ''}", re.I):
                continue
            if s_.get("end") and parse(s_["end"]) < now: continue
            if s_.get("start") and parse(s_["start"]) > now: continue
            if not s_.get("verified"): continue
            v = dt.datetime.fromisoformat(s_["verified"]).replace(tzinfo=dt.timezone.utc)
            if (now - v).total_seconds() > 7 * 86400: continue
            out.append((vendor, s_))
    return out


def check_members_only(browser, base, root, problems, notes):
    sales = json.load(open(os.path.join(root, "data", "vendor_sales.json"), encoding="utf-8"))
    cfg = json.load(open(os.path.join(root, "vendor_config.json"), encoding="utf-8"))
    our_codes = {str(c.get("promo_code") or "").lower() for c in cfg.values() if isinstance(c, dict)}
    codes = {s_["code"] for v, items in sales.items() if not v.startswith("_") for s_ in (items or [])
             if s_.get("code") and len(s_["code"]) >= 5 and s_["code"].lower() not in our_codes}
    for f in ("index.html", "suppliers.html"):
        raw = open(os.path.join(root, f), encoding="utf-8").read()
        leaked = sorted(c for c in codes if re.search(r"\b" + re.escape(c) + r"\b", raw))
        if leaked:
            problems.append(f"{f}: vendor sale code(s) in the page source (members-only): {leaked}")

    # Guest (no Functions on this static server -> /api/member-sales 404 ->
    # member-sales.js falls back to /data/vendor_sales.json). Sales are PUBLIC.
    excluded = ["Offline Peptides", "Licensed Peptides", "AFA Biosciences",
                "Research Peptides Lab", "Synthrolab"]
    page = open_page(browser, base + "/index.html", problems, "index.html (guest)")
    page.wait_for_timeout(800)
    g = page.evaluate("""() => ({
      badges: document.querySelectorAll('#index .sale-badge').length,
      deals: document.getElementById('dealsBand').classList.contains('show'),
      teaser: Boolean(document.getElementById('memberTeaser')),
      slotText: (document.getElementById('memberSalesSlot') || {}).innerText || '',
      bar: Boolean(document.getElementById('memberSalesBar')),
      dealVendors: [...document.querySelectorAll('#dealsScroll .deal-vendor')].map(e => e.textContent),
      onSaleVendors: [...new Set(DATA.included.flatMap(i => Object.keys(i.onSale || {})))],
      withCode: document.querySelectorAll('#index .price-amount.with-code').length,
    })""")
    notes.append(f"public sales (guest, homepage): bar={g['bar']} badges={g['badges']} salesStrip={g['deals']} "
                 f"onSaleVendors={g['onSaleVendors']} withCodePrices={g['withCode']}")
    if not g["bar"]:
        problems.append("index.html (guest): public vendor sales bar missing")
    if g["teaser"] or "join free" in g["slotText"].lower() or "Members see" in g["slotText"]:
        problems.append("index.html (guest): members-only teaser still shown")
    bad = [v for v in excluded if v in g["slotText"] or v in g["onSaleVendors"] or any(v in d for d in g["dealVendors"])]
    if bad:
        problems.append(f"index.html (guest): excluded vendor(s) in sales: {bad}")
    if g["onSaleVendors"] and not (g["badges"] and g["deals"]):
        problems.append(f"index.html (guest): observed sales not shown: {g}")
    if "applied automatically" in g["slotText"] and "automatic at checkout" in g["slotText"].split("applied automatically")[0].splitlines()[-1]:
        problems.append("index.html (guest): duplicated 'applied automatically' wording")
    if not g["withCode"]:
        problems.append("index.html (guest): no with-code prices rendered (code_discount_pct must still apply)")
    page.close()
    page = open_page(browser, base + "/suppliers.html", problems, "suppliers.html (guest)")
    page.wait_for_timeout(1000)
    rows = page.locator("text=Vendor sale:").count()
    teaser = page.locator("#memberTeaser").count()
    expected = len(live_vendor_sales(root))
    notes.append(f"public sales (guest, suppliers): vendor-sale rows={rows} (live in data: {expected}) teaser={teaser}")
    if rows != expected:
        problems.append(f"suppliers.html (guest): {rows} vendor sale rows, expected {expected}")
    if teaser:
        problems.append("suppliers.html (guest): members-only teaser still shown")
    page.close()

CURRENCY_ROWS_JS = r"""
() => {
  const cfg = (typeof VENDOR_CONFIG !== 'undefined') ? VENDOR_CONFIG : {};
  const PREFIX = { USD: '$', CAD: 'CA$', AUD: 'A$', NZD: 'NZ$', EUR: '\u20ac', GBP: '\u00a3' };
  const cur = v => String((cfg[v] || {}).currency || 'USD').toUpperCase();
  const out = { rows: 0, nonUsd: 0, nonUsdVendors: [], problems: [] };
  document.querySelectorAll('#index .price-row').forEach(row => {
    const vEl = row.querySelector('.vendor');
    const amtEl = row.querySelector('.price-amount');
    if (!vEl || !amtEl) return;
    const vendor = ((vEl.childNodes[0] && vEl.childNodes[0].textContent) || '').split(' \u00b7 ')[0].trim();
    const amt = amtEl.textContent.trim();
    const c = cur(vendor);
    out.rows++;
    const card = row.closest('.card');
    const where = (card && card.querySelector('h3') ? card.querySelector('h3').textContent : '?') + ' / ' + vendor;
    if (c === 'USD'){
      if (!/^\$\d/.test(amt)) out.problems.push(where + ': USD price shown as ' + JSON.stringify(amt));
    } else {
      out.nonUsd++;
      if (!out.nonUsdVendors.includes(vendor)) out.nonUsdVendors.push(vendor);
      const want = PREFIX[c] || (c + ' ');
      if (!amt.startsWith(want) || (want === '$')) out.problems.push(where + ': ' + c + ' price shown as ' + JSON.stringify(amt) + ' (expected prefix ' + JSON.stringify(want) + ')');
      if (row.classList.contains('lowest')) out.problems.push(where + ': ' + c + ' price is highlighted as the lowest price');
    }
    const label = (cfg[vendor] || {}).ships_to_label;
    if (label && !row.textContent.includes(label)) out.problems.push(where + ': missing shipping label ' + JSON.stringify(label));
  });
  return out;
}
"""

CURRENCY_SORT_JS = r"""
() => {
  const cfg = (typeof VENDOR_CONFIG !== 'undefined') ? VENDOR_CONFIG : {};
  const isUsd = v => String((cfg[v] || {}).currency || 'USD').toUpperCase() === 'USD';
  const cards = [...document.querySelectorAll('#index .card')];
  const flags = cards.map(card => [...card.querySelectorAll('.price-row .vendor')].some(el =>
    isUsd(((el.childNodes[0] && el.childNodes[0].textContent) || '').split(' \u00b7 ')[0].trim())));
  const firstNoUsd = flags.indexOf(false);
  const misplaced = firstNoUsd < 0 ? [] : cards.slice(firstNoUsd).filter((c, i) => flags[firstNoUsd + i])
    .map(c => c.querySelector('h3') ? c.querySelector('h3').textContent : '?');
  return { cards: cards.length, noUsd: flags.filter(f => !f).length, misplaced };
}
"""


def check_currency(page, label, problems, notes, sorts=True):
    """Non-USD prices: labelled with their currency, never the lowest price,
    shipping label shown, and (price sorts) cards without a USD price last."""
    r = page.evaluate(CURRENCY_ROWS_JS)
    notes.append(f"{label} currency: {r['rows']} price rows, {r['nonUsd']} non-USD"
                 + (f" ({', '.join(r['nonUsdVendors'])})" if r['nonUsdVendors'] else ""))
    problems.extend(f"{label}: {p}" for p in r["problems"][:20])
    if len(r["problems"]) > 20:
        problems.append(f"{label}: ...and {len(r['problems']) - 20} more currency problems")
    if not sorts:
        return
    for mode in ("price-low", "price-high"):
        try:
            page.select_option("#sortBy", mode)
            page.wait_for_timeout(400)
            s = page.evaluate(CURRENCY_SORT_JS)
            where = "placed last" if not s["misplaced"] else "NOT all placed last"
            notes.append(f"{label} sort {mode}: {s['cards']} cards, {s['noUsd']} with no USD price, {where}")
            if s["misplaced"]:
                problems.append(f"{label}: sort {mode} puts cards with no USD price before USD-priced cards: "
                                + ", ".join(s["misplaced"][:10]))
            r2 = page.evaluate(CURRENCY_ROWS_JS)
            problems.extend(f"{label} (sort {mode}): {p}" for p in r2["problems"][:10])
        except Exception as e:
            problems.append(f"{label}: could not exercise the price sort ({mode}): {str(e).splitlines()[0]}")
    try:
        page.select_option("#sortBy", "name")
        page.wait_for_timeout(300)
    except Exception:
        pass


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
    # Pre-dismiss the timed signup modal and the cookie banner (as declined,
    # so nothing loads from Google) so neither can cover what we click.
    page.add_init_script("try{localStorage.setItem('dp_modal_seen','dismissed');"
                         "localStorage.setItem('dp_consent','denied')}catch(e){}")
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
            check_currency(page, "fallback list", problems, notes, sorts=False)
            cur_problems = [x for x in problems if x.startswith("fallback list")]
            browser.close(); httpd.shutdown()
            print("\n".join(notes))
            if not fallback:
                print("FAIL: expected the render safety net to kick in, but it did not"); sys.exit(1)
            real = [x for x in problems if "product cards" in x or "vendor names" in x] + cur_problems
            if real:
                print("FAIL: safety net ran but did not draw a usable list:\n  " + "\n  ".join(real)); sys.exit(1)
            print("OK: main render broken as intended and the safety net drew a usable list"); sys.exit(0)

        if fallback:
            problems.append("index.html: render safety net was used (main render failed); see errors above")
        else:
            check_currency(page, "index.html", problems, notes)

        # ---- No dosing / reconstitution calculator anywhere. It was removed on
        # purpose: FDA has cited reconstitution calculators as evidence that
        # "research use only" products were meant for people.
        if os.path.exists(os.path.join(root, "calculator.html")):
            problems.append("calculator.html: exists again; the calculator was removed on purpose")
        for f in GA_PAGES:
            raw = open(os.path.join(root, f), encoding="utf-8", errors="replace").read()
            if re.search(r'calcSection|calcVial|calcDose|href="/calculator', raw):
                problems.append(f"{f}: contains calculator markup or a /calculator link")

        # ---- Suppliers nav item (homepage) must link to the /suppliers page
        try:
            href = page.get_attribute("#suppliersLink", "href", timeout=5000)
            notes.append(f"suppliers nav link: {href!r}")
            if (href or "").rstrip("/") not in ("/suppliers", "suppliers", "/suppliers.html", "suppliers.html"):
                problems.append(f"suppliers nav link: expected /suppliers, got {href!r}")
        except Exception as e:
            problems.append(f"suppliers nav link: missing: {str(e).splitlines()[0]}")
        # ---- Research nav item (homepage) links out to Peptide Health Digest;
        # testing.html is retired (301 in _redirects) and must not come back.
        try:
            link = page.locator("#testingLink")
            href, tgt, rel = (link.get_attribute(x, timeout=5000) for x in ("href", "target", "rel"))
            notes.append(f"research nav link: {href!r} target={tgt!r} rel={rel!r}")
            if href != RESEARCH_URL or tgt != "_blank" or "noopener" not in (rel or ""):
                problems.append(f"research nav link: expected {RESEARCH_URL} target=_blank rel=noopener, got {href!r} {tgt!r} {rel!r}")
        except Exception as e:
            problems.append(f"research nav link: missing: {str(e).splitlines()[0]}")
        if os.path.exists(os.path.join(root, "testing.html")):
            problems.append("testing.html exists again; it was retired (see _redirects)")
        for f in ("index.html", "about.html", "suppliers.html", "privacy.html", "research.html", "sitemap.xml"):
            if re.search(r'testing\.html|discountspeptides\.com/testing\b', open(os.path.join(root, f), encoding="utf-8").read()):
                problems.append(f"{f}: still links to the retired testing page")
        check_no_news(page, root, "index.html", problems)
        vendor_count = data_vendor_count(root)
        notes.append(f"vendor count in DATA: {vendor_count}")
        if not vendor_count:
            problems.append("index.html: could not read the vendor count from the DATA line")
        else:
            check_vendor_count_raw(root, "index.html", vendor_count, problems)
            check_vendor_count(page.inner_text("body"), "index.html (rendered page)", vendor_count, problems)
        page.close()

        # ---- suppliers.html
        page = open_page(browser, base + "/suppliers.html", problems, "suppliers.html")
        n = page.locator(".supplier-card").count()
        notes.append(f"suppliers.html: {n} cards")
        if n < MIN_SUPPLIERS:
            problems.append(f"suppliers.html: only {n} supplier cards (min {MIN_SUPPLIERS})")
        check_no_news(page, root, "suppliers.html", problems)
        if vendor_count:
            check_vendor_count_raw(root, "suppliers.html", vendor_count, problems)
            check_vendor_count(page.inner_text("body"), "suppliers.html (rendered page)", vendor_count, problems)
        page.close()

        # ---- about.html: the stats strip and any "N vendors" copy
        if vendor_count:
            page = open_page(browser, base + "/about.html", problems, "about.html")
            check_vendor_count_raw(root, "about.html", vendor_count, problems)
            text = page.inner_text("body")
            check_vendor_count(text, "about.html (rendered page)", vendor_count, problems)
            stat = page.inner_text("#statSuppliers").strip()
            notes.append(f"about.html: Suppliers stat {stat!r}")
            if stat != str(vendor_count):
                problems.append(f"about.html: Suppliers stat shows {stat!r} but the data has {vendor_count} vendors")
            page.close()

        # ---- Members-only sales
        check_members_only(browser, base, root, problems, notes)

        # ---- Google Analytics: consent-first banner, privacy page
        check_ga_static(root, problems, notes)
        page = open_page(browser, base + "/privacy.html", problems, "privacy.html")
        page.close()
        check_ga_first_visit(browser, base, problems, notes)
        browser.close()
    httpd.shutdown()

    print("\n".join(notes))
    if problems:
        print("\nFAIL:\n  " + "\n  ".join(problems)); sys.exit(1)
    print("\nOK: site smoke test passed")


if __name__ == "__main__":
    main()
