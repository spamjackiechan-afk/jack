// Returns every APPROVED review as JSON. Pending and rejected reviews are
// never included here — this is the only endpoint the public-facing site
// reads from, so anything not yet approved is simply invisible to visitors.
// Merges per-record review:* keys with the old "reviews" blob.
//
// Cached at the edge for 5 minutes (Cache API, per data centre) so page loads
// don't each spend a KV list request (free plan: 1,000 a day). New approvals
// can take up to 5 minutes to show. The admin page reads KV directly through
// admin-reviews.js, so it always sees fresh data.

import { readReviews, readJson } from "../_lib/records.js";

const CACHE_SECONDS = 300;
const FALLBACK_CACHE_SECONDS = 60;

export async function onRequestGet(context) {
  const { request, env } = context;

  // Stable cache key: this path with no query string, so ?anything can't
  // create extra cache entries or skip the cache.
  const cacheKey = new Request(new URL("/api/get-reviews", request.url).toString(), { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(cacheKey).catch(() => null);
  if (cached) return cached;

  let reviews = [];
  let fellBack = false;
  try {
    reviews = await readReviews(env.CLICK_COUNTS, "approved");
  } catch (e) {
    // e.g. the daily list limit is used up: serve the old blob instead.
    console.error("get-reviews: per-record read failed, using old 'reviews' blob:", e);
    fellBack = true;
    const blob = await readJson(env.CLICK_COUNTS, "reviews", []);
    reviews = (Array.isArray(blob) ? blob : []).filter(r => r && r.status === "approved");
  }

  const response = new Response(JSON.stringify(reviews), {
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
