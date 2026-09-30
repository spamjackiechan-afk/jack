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
- the homepage Suppliers nav item doesn't link to `/suppliers`, or `suppliers.html` shows fewer than 8 supplier cards.
- the References news markup from `testing.html` (`news-tier`, `news-item`,
  `news-type`, `peptide-chip`, `data-tone`, `tone-read`, "Looks concerning",
  "Developing") appears in `index.html` or `suppliers.html`, in the file or the
  rendered page, or `testing.html` shows fewer than 20 reference items.

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

## Vendor config: public fields only

`vendor_config.json` and the `VENDOR_CONFIG` embeds are public (anyone can
view source or open `/vendor_config.json`), so they hold only the fields the
site code reads: status, links, promo code, payment, shipping and testing
fields. Internal notes (`commission`, `cookie_days`, `guidelines_notes`,
`last_checked`, `_readme`, `_field_guide`) live in a private
`vendor_notes.json` kept outside this repo. Jackson decides where it is stored.
Never add them back here. `private/` is git-ignored as a safety net.

To change a public field, edit `vendor_config.json`, then run:

```
python scripts/sync_vendor_config.py
```

This drops any non-public field and rewrites only the `VENDOR_CONFIG` line in
`index.html` and `suppliers.html`. Commit all three files. Old commits in git
history still contain the notes removed on 2026-09-29.

## Safety nets in the page

- If `CATEGORIES` is missing, it defaults to `{}` (category filter shows only
  "All") and a `[site-guard]` error is logged.
- If the main script stops before drawing listings, a small script at the end
  of `index.html` draws a plain list of products and vendor prices from
  `DATA` / `VENDOR_CONFIG` (or `vendor_config.json`) plus
  `data/live_prices.json`. It shows prices and links only: no codes, no deals.
  It does nothing when the normal render works.

## testing.html References (Latest / Recent)

The References list on `testing.html` is grouped into **Latest** (dated in the
last 14 days, worked out when the page loads) and **Recent** (everything else),
newest first, with a neutral type label, date, publisher and peptide chips.
The data is the `NEWS` array in `testing.html`; the format and rules are in
[`references-format.md`](references-format.md). It lives on `testing.html`
only: no homepage teaser, and site-smoke fails if its markup shows up on
`index.html` or `suppliers.html`. Tone labels and a "Live" tier are reserved in
the data but deliberately not rendered until a lawyer has reviewed the wording.
