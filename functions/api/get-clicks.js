// Returns every recorded click count as JSON, keyed by "peptide|||vendor".
// The site fetches this once on page load to decide which listings to
// mark as popular — real counts, starting at zero, nothing invented.
//
// Requires the same CLICK_COUNTS KV binding as track-click.js.
// Merges the per-pair click:* keys with the old "counts" blob.

import { readClickCounts } from "../_lib/records.js";

export async function onRequestGet(context) {
  const { env } = context;

  let counts = {};
  try {
    counts = await readClickCounts(env.CLICK_COUNTS);
  } catch (e) {
    counts = {};
  }

  return new Response(JSON.stringify(counts), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60",
    },
  });
}
