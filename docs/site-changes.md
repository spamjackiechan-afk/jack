# Making site changes safely

Cloudflare (Worker `jack`) deploys **main** straight to discountspeptides.com.
Anything merged or pushed to main is live within about a minute.

**All site changes go through a pull request.** The `Site smoke test`
workflow (`.github/workflows/site-smoke.yml`, check name `site-smoke`) runs on
every PR. Do not merge unless it is green. It also runs on every push to main
and after each automated price run.

It is **not** a GitHub-enforced required check yet. This is a personal-account
repo, and GitHub won't let the Actions bot bypass a ruleset here, so requiring
`site-smoke` would reject the daily price bot's direct push of
`data/live_prices.json` to main. To enforce it later, either move the repo to
an organization (then add a ruleset requiring `site-smoke`, with GitHub
Actions as a bypass actor) or change the price bot to push a branch, run
`scripts/smoke_test.py`, and only then update main.

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
