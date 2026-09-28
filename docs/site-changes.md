# Making site changes safely

Cloudflare (Worker `jack`) deploys **main** straight to discountspeptides.com.
Anything merged or pushed to main is live within about a minute.

**All site changes go through a pull request.** The `Site smoke test`
workflow (`.github/workflows/site-smoke.yml`, check name `site-smoke`) runs on
every PR and must pass before merging. It is a required status check on main
(repository ruleset "main: require site smoke test"). The price bot is
allowed to bypass it for its automated `data/live_prices.json` commits, and
the check re-runs on main after each price run.

The check serves the repo statically and renders it in headless Chromium. It fails if:

- any uncaught JavaScript error happens on `index.html` or `suppliers.html`;
- the homepage shows fewer than 50 product cards or fewer than 8 vendor names;
- the in-page render safety net had to kick in (`[site-guard]` console errors);
- the reconstitution calculator doesn't return `10 units` for 5 mg / 2 mL / 0.25 mg;
- the Suppliers panel or `suppliers.html` shows fewer than 8 supplier cards.

It also breaks a scratch copy on purpose (deletes `CATEGORIES`) and checks
that the safety net still draws a usable vendor list.

Run it locally before opening a PR:

```
pip install playwright && playwright install chromium
python scripts/smoke_test.py
```

## Editing the embeds in index.html / suppliers.html

`const DATA = …`, `const VENDOR_CONFIG = …` and `const CATEGORIES = …` are
each on **their own line** near the top of the main `<script>`. When
re-syncing `VENDOR_CONFIG` from `vendor_config.json`, replace only that line.
Do not delete the `CATEGORIES` line or the `typeof CATEGORIES` guard below
it. (On 2026-09-26, PR #49 rewrote a line that also held `CATEGORIES` and
blanked the homepage until PR #50.)

## Safety nets in the page

- If `CATEGORIES` is missing, it defaults to `{}` (category filter shows only
  "All") and a `[site-guard]` error is logged.
- If the main script stops before drawing listings, a small script at the end
  of `index.html` draws a plain list of products and vendor prices from
  `DATA` / `VENDOR_CONFIG` (or `vendor_config.json`) plus
  `data/live_prices.json`. It shows prices and links only: no codes, no deals.
  It does nothing when the normal render works.
