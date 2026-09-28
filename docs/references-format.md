# testing.html References format

The References list at the bottom of `testing.html` is built from the `NEWS`
array in that file's script. This page describes the format. It applies to
`testing.html` only. Nothing from it goes on the homepage, suppliers or about
pages (site-smoke checks index.html and suppliers.html).

## One entry

```js
{ n: 15, type: 'FDA warning letter', publisher: 'FDA',
  title: 'Warning Letter — Peak Performance Peptides',
  date: '2026-08-24', url: 'https://www.fda.gov/…',
  tags: ['Retatrutide', 'Semaglutide'], tier: null, tone: '' }
```

| Field | Required | Notes |
|---|---|---|
| `n` | yes | Permanent number. The item's anchor is `#src-<n>` and other pages/text may link to it. Never renumber or reuse; new items take the next number. |
| `type` | yes | Neutral document type, from the list below. |
| `publisher` | yes | Who published it (outlet, agency, journal). |
| `title` | yes | The source's own title, or a plain factual description if it has none. No commentary. |
| `url` | yes | Link to the source. Don't change existing URLs. |
| `date` | yes | `'YYYY-MM-DD'`, `'YYYY-MM'`, `'YYYY'`, or `null` when the source gives no date. Use the date shown on the source. Never guess. |
| `date_text` | no | Display override, e.g. `'23–24 Jul 2026'` or `'Updated 22 Apr 2026'`. `date` still drives sorting. |
| `tags` | yes | Peptides the source is specifically about. Shown as chips. `[]` if none. |
| `tier` | yes | `null`. `'live'` is reserved (see below) and is **not rendered**. |
| `tone` | yes | `''`. Reserved (see below) and **not rendered**. |

### Type labels

Use one of these, and add a new one only if none fits:
`FDA warning letter`, `FDA announcement`, `FDA guidance`, `FDA list`,
`Federal Register notice`, `Advisory committee`, `Court filing`,
`Legal analysis`, `News report`, `Study`, `Review article`, `Case report`,
`Reference`.

## How it renders

- **Latest**: items with a full `YYYY-MM-DD` date no more than 14 days
  before the visitor's current date (`LATEST_DAYS`). If there are none, the
  section says "Nothing new in the last 14 days."
- **Recent**: everything else, including year-only and undated items.
- Each section is sorted newest first, then by `n` (higher first). Undated
  items go last.
- Each item shows the type, date, publisher, `#n`, title (linked), host name
  and peptide chips.
- The array order doesn't matter. Append new items at the end.

Items move from Latest to Recent on their own as they age, so no edit is
needed.

## Reserved, not shown: `tier: 'live'` and `tone`

The format can hold a "Live/Developing" tier (`tier: 'live'`, for open
matters such as pending lawsuits) and a `tone` read. **Neither is rendered**,
and neither should be published until a lawyer has reviewed the wording. Until
then:

- keep `tier: null` and `tone: ''` on every item;
- no editorial labels anywhere in the list: no "concerning", "positive",
  "developing" or similar;
- the render code ignores both fields, so setting them has no visible effect.
  Turning them on is a separate, reviewed change.

## Adding a source

1. Check the source page for its title, publisher and date.
2. Append an entry with the next `n`.
3. Run `python scripts/smoke_test.py`.
