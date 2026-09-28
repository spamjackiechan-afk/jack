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
from check_prices import apply_live_overlay  # noqa: E402


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

    def test_real_repo_data_offline_404s_hidden(self):
        inc = copy.deepcopy(load_data()["included"])
        live = json.loads((ROOT / "data" / "live_prices.json").read_text())
        apply_live_overlay(inc, live["results"])
        for key, r in live["results"]["Offline Peptides"].items():
            pep, fmt, size = key.split(" | ")
            m = next((i for i in inc if (i["peptide"], i["format"], i["size"]) == (pep, fmt, size)), None)
            if r.get("price") is None:
                self.assertTrue(m is None or "Offline Peptides" not in m["prices"], key)
        for i in inc:
            self.assertEqual(i["lowest"], min(i["prices"].values()), i["peptide"])

    @unittest.skipUnless(shutil.which("node"), "node not installed")
    def test_page_js_matches_python_reference(self):
        html = (ROOT / "index.html").read_text()
        m = re.search(r"^function applyLiveOverlay\(results\)\{.*?^\}", html, re.S | re.M)
        self.assertIsNotNone(m, "applyLiveOverlay not found in index.html")
        data = load_data()
        live = json.loads((ROOT / "data" / "live_prices.json").read_text())
        js = ("const DATA = " + json.dumps(data) + ";\n" + m.group(0) +
              "\napplyLiveOverlay(" + json.dumps(live["results"]) + ");\n"
              "process.stdout.write(JSON.stringify(DATA.included));")
        out = subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout
        page = json.loads(out)
        ref = copy.deepcopy(data["included"])
        apply_live_overlay(ref, live["results"])
        self.assertEqual(page, ref)


if __name__ == "__main__":
    unittest.main(verbosity=2)
