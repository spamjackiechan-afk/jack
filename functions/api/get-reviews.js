// Returns every APPROVED review as JSON. Pending and rejected reviews are
// never included here — this is the only endpoint the public-facing site
// reads from, so anything not yet approved is simply invisible to visitors.
// Reads ONE key, the approved-reviews snapshot that admin-reviews.js and
// admin-migrate.js rewrite, so it makes no KV list requests (free plan:
// 1,000 a day). Until the first approval/migration writes the snapshot, and
// on any error, it serves the approved reviews from the old "reviews" blob.
//
// Also cached at the edge for 5 minutes (Cache API, per data centre), so new
// approvals can take up to 5 minutes to show. The admin page reads KV
// directly through admin-reviews.js, so it always sees fresh data.

import { REVIEWS_SNAPSHOT_KEY, approvedFromBlob } from "../_lib/records.js";

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
    const raw = await env.CLICK_COUNTS.get(REVIEWS_SNAPSHOT_KEY);
    if (raw === null) {
      // No snapshot yet (before the first approval or the migration).
      reviews = await approvedFromBlob(env.CLICK_COUNTS);
    } else {
      reviews = JSON.parse(raw);
      if (!Array.isArray(reviews)) throw new Error("snapshot is not an array");
    }
  } catch (e) {
    console.error("get-reviews: snapshot read failed, using old 'reviews' blob:", e);
    fellBack = true;
    reviews = await approvedFromBlob(env.CLICK_COUNTS);
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
