// Returns every APPROVED review as JSON. Pending and rejected reviews are
// never included here — this is the only endpoint the public-facing site
// reads from, so anything not yet approved is simply invisible to visitors.
// Merges per-record review:* keys with the old "reviews" blob.

import { readReviews } from "../_lib/records.js";

export async function onRequestGet(context) {
  const { env } = context;

  let reviews = [];
  try {
    reviews = await readReviews(env.CLICK_COUNTS, "approved");
  } catch (e) {
    reviews = [];
  }

  return new Response(JSON.stringify(reviews), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60",
    },
  });
}
