# Testing refs filter

Used by the Grok automation `testing-refs-weekly`.
Does not publish. A finding is proposed for `testing.html` only if all four gates pass.

Live page: https://discountspeptides.com/testing.html
Source files: `testing.html`, `data/testing-refs-status.json`, `vendor_config.json`

After a human approves a draft (or a NO CHANGE verify), update:
- `data/testing-refs-status.json` (`last_verified`, `status`)
- the "last verified" line on `testing.html` (`#refs-verified`)
- `testing.html` Sources / concern copy only when verdict is PROPOSE and Jackson accepts it

## Gate 1 — source_ok

Allowed:
- fda.gov
- wada-ama.org
- PubMed / peer-reviewed journals (DOI or PMID)
- science.org (AAAS)
- nytimes.com
- wired.com
- reuters.com
- apnews.com
- npr.org
- cnbc.com
- statnews.com
- pharmacytimes.com
- pharmaceutical-technology.com / pharmtech.com
- Academic medical centers (e.g. uclahealth.org)

Reject: vendor blogs, affiliate sites, Discord, TikTok, X hype, gray-market shops.

## Gate 2 — bucket_ok

Must map to an existing concern on `testing.html`:

1. Contested identity — TB-500 / blends (fragment vs full-length thymosin β4)
2. No approval + documented adverse events — Melanotan II
3. Unapproved + active enforcement — GLP-1 development class (retatrutide lawsuits)
4. Approved medicines sold outside the prescription system
5. Sport prohibition / mixed regulatory category — SARMs and GH secretagogues (WADA)

If it does not map: list under **Do not apply**. Do not create a new accordion.

## Gate 3 — link_ok

- URL loads (not 404)
- Title and date match the citation
- Claim in the draft is no stronger than the source
- PCAC vote ≠ FDA approval ≠ 503A list addition

## Gate 4 — catalog_ok

Compound is already on the site (vendor listings / `vendor_config.json` / testing page), **or** the item is a site-wide rule (WADA list, GLP-1 enforcement class).
Random peptides not sold or listed here: **Do not apply**.

## Output for each candidate

```
source_ok: yes/no
bucket_ok: yes/no — bucket number or none
link_ok: yes/no
catalog_ok: yes/no
verdict: PROPOSE | REJECT
```

Propose only if all four are yes.
If any PROPOSE or a current numbered ref is dead, open a GitHub issue:
`[testing refs] YYYY-MM-DD draft`
Do not edit `testing.html` or other live files from the automation.
