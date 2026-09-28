# Site Guide — Offline Peptides partner-guideline compliance

Source: Offline Peptides "Updated content guidelines" email + Partner Guide PDF (Sat Sep 26, 2026).
Relevant rules: no naming/showing GLP-category products (GLP-1S, GLP-2T, GLP-3R, any GLP blend);
no water/mixing/reconstitution/preparation/storage; no dosing/administration/protocols/cycles/personal use;
no health/weight/performance/recovery/appearance claims; no prescription-drug names or comparisons.
The rules apply to every piece of content that mentions Offline Peptides.

Site Guide hard rule (mirrors system prompt / skill):
- Never pair Offline Peptides with GLP-category products (semaglutide, tirzepatide, retatrutide,
  cagrilintide, orforglipron, any GLP blend), the Metabolic & Weight shelf / fat-loss topic, or any
  dosing / reconstitution / bac-water / storage / personal-use answer.
- Refusal replies stay vendor-free.

Enforcement in `functions/api/site-guide.js`:
- `formatPrices()` skips Offline Peptides rows whose catalog key is GLP-category.
- `enforceOfflineCompliance()` runs on every reply: when the question or reply involves GLP /
  Metabolic & Weight / fat-loss / dosing-prep, Offline bullet rows are dropped and Offline names/links
  are stripped from inline text (e.g. evidence `catalog_keys`). Non-GLP answers (GLOW, KLOW, BPC-157 …)
  are unchanged.
- `isRefusal()` also catches bac-water / "should I inject" / "how much … inject" / mixing / storage /
  dosage / protocol phrasings, so they get the vendor-free refusal instead of a price lookup.

Out of scope for this widget change (reported separately): the home/suppliers price tables
(`index.html` / `suppliers.html` baked `DATA`) still list Offline GLP rows and links.
