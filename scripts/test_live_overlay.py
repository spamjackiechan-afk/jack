#!/usr/bin/env python3
"""Unit-style tests for the live-price overlay (null / 404 -> row cleared).

Run:  python scripts/test_live_overlay.py
Needs only the stdlib (+ requests/bs4, which check_prices imports). If `node`
is on PATH it also runs index.html's applyLiveOverlay against the same inputs
and checks the page and the Python reference agree. Works on copies only; it
never writes data/live_prices.json or fetches anything.
"""
import copy, json, re, shutil, subprocess, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from check_prices import apply_live_overlay, non_usd_vendors, usd_lowest  # noqa: E402


def row(peptide, size, prices, urls=None, fmt="Vial"):
    return {"peptide": peptide, "format": fmt, "size": size, "prices": dict(prices),
            "lowest": min(prices.values()), "vendor_product_urls": dict(urls or {})}


def load_data():
    for line in (ROOT / "index.html").read_text().split("\n"):
        if line.startswith("const DATA = "):
            return json.loads(line[len("const DATA = "):].rstrip(";"))
    raise AssertionError("DATA line not found in index.html")


class OverlayTests(unittest.TestCase):
    def test_null_clears_vendor_and_recomputes_lowest(self):
        inc = [row("X", "10mg", {"A": 30.0, "B": 50.0}, {"A": "https://a/x", "B": "https://b/x"})]
        res = {"A": {"X | Vial | 10mg": {"url": "https://a/x", "price": None, "error": "404 Client Error"},
                     "Y | Vial | 5mg": {"url": "https://a/y", "price": 8.0, "error": None}},
               "B": {"X | Vial | 10mg": {"url": "https://b/x", "price": 48.0, "regular_price": None, "error": None},
                     "Y | Vial | 5mg": {"url": "https://b/y", "price": 9.0, "error": None}}}
        apply_live_overlay(inc, res)
        self.assertEqual(inc[0]["prices"], {"B": 48.0})
        self.assertNotIn("A", inc[0]["vendor_product_urls"])
        self.assertEqual(inc[0]["lowest"], 48.0)

    def test_row_dropped_when_last_vendor_nulls(self):
        inc = [row("X", "10mg", {"A": 30.0}), row("Z", "1mg", {"A": 5.0})]
        res = {"A": {"X | Vial | 10mg": {"price": None, "error": "404"},
                     "Z | Vial | 1mg": {"price": 6.0, "error": None}}}
        apply_live_overlay(inc, res)
        self.assertEqual([r["peptide"] for r in inc], ["Z"])

    def test_all_null_vendor_is_left_alone(self):
        inc = [row("X", "10mg", {"A": 30.0, "B": 40.0})]
        res = {"A": {"X | Vial | 10mg": {"price": None, "error": "timeout"},
                     "Q | Vial | 1mg": {"price": None, "error": "timeout"}}}
        apply_live_overlay(inc, res)
        self.assertEqual(inc[0]["prices"], {"A": 30.0, "B": 40.0})

    def test_vendor_not_on_row_is_not_added(self):
        inc = [row("X", "10mg", {"A": 30.0})]
        apply_live_overlay(inc, {"B": {"X | Vial | 10mg": {"price": 1.0, "error": None},
                                       "W | Vial | 1mg": {"price": 2.0, "error": None}}})
        self.assertEqual(inc[0]["prices"], {"A": 30.0})

    def test_offline_never_gets_onsale(self):
        inc = [row("X", "10mg", {"Offline Peptides": 30.0, "B": 40.0})]
        res = {"Offline Peptides": {"X | Vial | 10mg": {"price": 25.0, "regular_price": 30.0, "error": None}},
               "B": {"X | Vial | 10mg": {"price": 32.0, "regular_price": 40.0, "error": None}}}
        apply_live_overlay(inc, res)
        self.assertEqual(inc[0].get("onSale"), {"B": 40.0})
        self.assertEqual(inc[0]["lowest"], 25.0)

    def test_non_usd_price_never_lowest(self):
        inc = [row("X", "10mg", {"A": 50.0, "CadShop": 40.0}), row("Y", "5mg", {"CadShop": 30.0})]
        res = {"CadShop": {"X | Vial | 10mg": {"price": 35.0, "regular_price": None, "error": None},
                           "Y | Vial | 5mg": {"price": 31.0, "regular_price": None, "error": None}},
               "A": {"X | Vial | 10mg": {"price": 55.0, "regular_price": None, "error": None}}}
        apply_live_overlay(inc, res, non_usd={"CadShop": "CAD"})
        self.assertEqual(inc[0]["prices"], {"A": 55.0, "CadShop": 35.0})  # kept, not converted
        self.assertEqual(inc[0]["lowest"], 55.0)   # the USD price, not the cheaper CAD one
        self.assertEqual(inc[1]["prices"], {"CadShop": 31.0})
        self.assertIsNone(inc[1]["lowest"])         # CAD-only row: no lowest

    def test_real_repo_data_offline_404s_hidden(self):
        inc = copy.deepcopy(load_data()["included"])
        live = json.loads((ROOT / "data" / "live_prices.json").read_text())
        apply_live_overlay(inc, live["results"])
        for key, r in live["results"]["Offline Peptides"].items():
            pep, fmt, size = key.split(" | ")
            m = next((i for i in inc if (i["peptide"], i["format"], i["size"]) == (pep, fmt, size)), None)
            if r.get("price") is None:
                self.assertTrue(m is None or "Offline Peptides" not in m["prices"], key)
        non_usd = non_usd_vendors()
        for i in inc:
            self.assertEqual(i["lowest"], usd_lowest(i["prices"], non_usd), i["peptide"])

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_page_js_matches_python_reference(self):
        html = (ROOT / "index.html").read_text()
        m = re.search(r"^function applyLiveOverlay\(results\)\{.*?^\}", html, re.S | re.M)
        self.assertIsNotNone(m, "applyLiveOverlay not found in index.html")
        cur = re.search(r"^// ---------- Currency .*?^// ---------- end currency ----------$", html, re.S | re.M)
        self.assertIsNotNone(cur, "currency helpers not found in index.html")
        cfg_line = next(l for l in html.split("\n") if l.startswith("const VENDOR_CONFIG = "))
        data = load_data()
        live = json.loads((ROOT / "data" / "live_prices.json").read_text())
        js = (cfg_line + "\n" + cur.group(0) + "\nconst DATA = " + json.dumps(data) + ";\n" + m.group(0) +
              "\napplyLiveOverlay(" + json.dumps(live["results"]) + ");\n"
              "process.stdout.write(JSON.stringify(DATA.included));")
        # Script goes in on stdin: as an argument it can exceed the OS limit (E2BIG).
        out = subprocess.run(["node"], input=js, capture_output=True, text=True, check=True).stdout
        page = json.loads(out)
        ref = copy.deepcopy(data["included"])
        apply_live_overlay(ref, live["results"])
        self.assertEqual(page, ref)


if __name__ == "__main__":
    unittest.main(verbosity=2)
