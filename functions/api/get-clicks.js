// Returns every recorded click count as JSON, keyed by "peptide|||vendor".
// The site fetches this once on page load to decide which listings to
// mark as popular — real counts, starting at zero, nothing invented.
//
// Requires the same CLICK_COUNTS KV binding as track-click.js.
// Merges the per-pair click:* keys with the old "counts" blob.
//
// Cached at the edge for 5 minutes (Cache API, per data centre) so page loads
// don't each spend a KV list request (free plan: 1,000 a day). New clicks can
// take up to 5 minutes to show.

import { readClickCounts, readJson } from "../_lib/records.js";

const CACHE_SECONDS = 300;
const FALLBACK_CACHE_SECONDS = 60;

export async function onRequestGet(context) {
  const { request, env } = context;

  // Stable cache key: this path with no query string.
  const cacheKey = new Request(new URL("/api/get-clicks", request.url).toString(), { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(cacheKey).catch(() => null);
  if (cached) return cached;

  let counts = {};
  let fellBack = false;
  try {
    counts = await readClickCounts(env.CLICK_COUNTS);
  } catch (e) {
    // e.g. the daily list limit is used up: serve the old blob instead
    // (after the migration its numbers stop growing, but they're real).
    console.error("get-clicks: per-record read failed, using old 'counts' blob:", e);
    fellBack = true;
    const blob = await readJson(env.CLICK_COUNTS, "counts", {});
    counts = blob && typeof blob === "object" && !Array.isArray(blob) ? blob : {};
  }

  const response = new Response(JSON.stringify(counts), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": `public, max-age=${fellBack ? FALLBACK_CACHE_SECONDS : CACHE_SECONDS}`,
    },
  });
  context.waitUntil(cache.put(cacheKey, response.clone()).catch(() => {}));
  return response;
}
