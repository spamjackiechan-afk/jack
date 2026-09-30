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
- the embedded `DATA` / `VENDOR_CONFIG` lines don't exactly match
  `data/catalog.json` (minus any hidden vendors, see below) / `vendor_config.json`.
- the References news markup from `testing.html` (`news-tier`, `news-item`,
  `news-type`, `peptide-chip`, `data-tone`, `tone-read`, "Looks concerning",
  "Developing") appears in `index.html` or `suppliers.html`, in the file or the
  rendered page, or `testing.html` shows fewer than 20 reference items.
- a vendor count on `index.html`, `suppliers.html` or `about.html` ("13 vendors",
  "13 suppliers", the title and meta tags, the About "Suppliers" stat), in the
  file or the rendered page, differs from the number of distinct vendors with
  listings in the homepage `DATA`. When a vendor is added or removed, update
  that copy in the same PR.

It also breaks a scratch copy on purpose (deletes `CATEGORIES`) and checks
that the safety net still draws a usable vendor list.

Run it locally before opening a PR:

```
pip install playwright && playwright install chromium
python scripts/smoke_test.py
```

## Editing the embeds in index.html / suppliers.html

`const DATA = …`, `const VENDOR_CONFIG = …` and `const CATEGORIES = …` are
each on **their own line** near the top of the main `<script>`.

`DATA` and `VENDOR_CONFIG` are generated. Don't edit them by hand. **Edit the
JSON, run the sync script, commit both:**

- product data: `data/catalog.json` → `const DATA` in both pages
- vendor fields: `vendor_config.json` → `const VENDOR_CONFIG` in both pages

```
python scripts/sync_vendor_config.py          # rewrites only those two lines
python scripts/sync_vendor_config.py --check  # what site-smoke runs
```

site-smoke fails if either embed line differs from its JSON file.

### Hiding a vendor (keeping its data)

To take a vendor off the site without deleting anything (e.g. its site is
down), add `"hidden": true` to its entry in `vendor_config.json` and run the
sync. The generated `const DATA` line then leaves that vendor out: its
prices and links are removed from every row, `lowest` is recomputed, and
rows with no other vendor are dropped. `data/catalog.json`,
`data/product_urls.json` and its `VENDORS` entry in `check_prices.py` stay as
they are, and the price checker skips hidden vendors. The site's vendor count
drops by one, so update the count copy as for a removal. To bring the vendor
back, delete the flag, run the sync and update the count again.
Do not delete the `CATEGORIES` line or the `typeof CATEGORIES` guard below
it. (On 2026-09-26, PR #49 rewrote a line that also held `CATEGORIES` and
blanked the homepage until PR #50.)

## Vendor config: public fields only

`vendor_config.json` and the `VENDOR_CONFIG` embeds are public (anyone can
view source or open `/vendor_config.json`), so they hold only the fields the
site code reads: status, links, promo code, payment and shipping fields.
Internal notes (`commission`, `cookie_days`, `guidelines_notes`,
`last_checked`, `testing_tier`, `_readme`, `_field_guide`) and the vendor
testing fields (`testing_methods`, `testing_lab`, `testing_standard`,
`testing_note`, `testing_researched`; no visible page shows them) live in a
private `vendor_notes.json` kept outside this repo. Jackson decides where it is stored.
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

## Reviews, subscribers and clicks in KV

The API functions store **one KV key per record** in `CLICK_COUNTS`:
`review:<id>`, `sub:<email>` and `click:<peptide>|||<vendor>` (helpers in
`functions/_lib/records.js`). The old single blobs (`reviews`, `subscribers`,
`counts`) are still read and merged, so older data keeps showing, and they are
never deleted by code. `POST /api/admin-migrate` (admin login; `?dry_run=1`
to preview, writes nothing) copies the blobs into per-record keys. Only run it
when Jackson says so. Deleting the old blobs afterwards is his decision.

The migration works in batches of at most 800 KV operations per request
(Cloudflare allows 1,000). A response with `"complete": false` includes
`next_cursor`: run it again with `?cursor=<next_cursor>` to continue. Running
it again without a cursor is safe (done records are skipped) but re-checks
from the start. Each click counter is marked done in the same write that adds
its old count, so a re-run can't count it twice. The free plan allows 1,000 KV
writes a day for everything (clicks and sign-ups too): check
`writes_this_run` / the dry run's `estimated_writes`, and if needed, spread
the batches over several days. A run that hits the limit stops with an error
and a `next_cursor` to continue from the next day.

`/api/get-reviews` reads one key, `reviews:approved_snapshot`, and makes no
list requests. Approving or rejecting a review on the admin page, and the
migration's last step, rewrite that key. Until it exists, and on any error,
get-reviews serves the approved reviews from the old `reviews` blob.
`/api/get-clicks` still lists `click:*` keys (free plan: 1,000 list requests
a day). Both are cached for 5 minutes per Cloudflare data centre (Cache API),
so new approvals and clicks can take up to 5 minutes to show. If get-clicks
can't list, it returns the old `counts` blob instead (still 200) and logs the
error. The admin page reads KV directly.

New unsubscribe links should include the subscriber's token:
`/api/subscribe?unsubscribe=<email>&token=<unsubscribe_token>`. The token is in
each `sub:<email>` record, and the migration adds one for older subscribers.
Old email-only links (`?unsubscribe=<email>`, no token) keep working while
`ALLOW_EMAIL_ONLY_UNSUBSCRIBE` in `functions/api/subscribe.js` is `true`:
CAN-SPAM requires an opt-out link to keep working for at least 30 days after
each email is sent. Only switch it off once every email that went out with an
email-only link is more than 30 days old.

The review and email forms carry a hidden `website` honeypot field and the time
since the form appeared (`form_ms`). The server rejects honeypot-filled
submissions and anything sent within 3 seconds, and limits each IP to 3 reviews
and 5 sign-ups per hour (`rl:review:<ip>`, `rl:sub:<ip>`).

## Manual sale prices (price overrides)

The daily price run rewrites `data/live_prices.json` from scratch. To keep a
confirmed sale price (e.g. from a vendor's code email), add it to
`data/price_overrides.json` under the vendor and the **exact** item key from
`data/product_urls.json`, with `price`, `regular_price`, `expires` (UTC,
`YYYY-MM-DDTHH:MM:SSZ`) and `source`. `scripts/check_prices.py` merges
unexpired entries after each run and marks them `"override": true`. It skips
and logs expired entries and keys that aren't in the catalogue, and it never
works out prices for other sizes. Jackson confirms every entry before it goes in.
