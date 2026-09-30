// Accepts a new vendor review submission. Every review starts as "pending"
// and is invisible to the public until approved via the admin page — see
// admin-reviews.js. This is intentional: user-generated content on a
// research-peptide site needs a human checkpoint before it goes live,
// given how easily "review the vendor" drifts into "review the compound."
//
// Requires the same KV namespace already bound for click tracking
// (CLICK_COUNTS), reusing it with a different key prefix rather than
// requiring a second namespace. Each review is its own key (review:<id>);
// see functions/_lib/records.js.

import { putReview, looksAutomated, underRateLimit, clientIp, GENERIC_ERROR } from "../_lib/records.js";

const MAX_NAME_LEN = 60;
const MAX_PEPTIDE_LEN = 80;
const MAX_REVIEW_LEN = 2000;
const MIN_REVIEW_LEN = 10;
const URL_PATTERN = /https?:\/\/|www\./i;
const MAX_REVIEWS_PER_IP_PER_HOUR = 3;

function sanitize(str) {
  return String(str || "").trim().slice(0, 5000);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  // Honeypot filled in, or sent too fast after the form appeared.
  if (looksAutomated(body)) {
    return new Response(JSON.stringify({ error: GENERIC_ERROR }), { status: 400 });
  }

  const vendor = sanitize(body.vendor);
  const peptide = sanitize(body.peptide_ordered);
  const reviewerName = sanitize(body.reviewer_name);
  const reviewText = sanitize(body.review_text);
  const rating = parseInt(body.rating, 10);

  // Basic validation — the admin approval step is the real gate, this just
  // rejects obviously malformed or spammy submissions before they're stored.
  if (!vendor || vendor.length > 100) {
    return new Response(JSON.stringify({ error: "Missing or invalid vendor" }), { status: 400 });
  }
  if (!reviewerName || reviewerName.length > MAX_NAME_LEN) {
    return new Response(JSON.stringify({ error: "Missing or invalid name" }), { status: 400 });
  }
  if (peptide.length > MAX_PEPTIDE_LEN) {
    return new Response(JSON.stringify({ error: "Peptide field too long" }), { status: 400 });
  }
  if (!reviewText || reviewText.length < MIN_REVIEW_LEN || reviewText.length > MAX_REVIEW_LEN) {
    return new Response(JSON.stringify({ error: `Review must be ${MIN_REVIEW_LEN}-${MAX_REVIEW_LEN} characters` }), { status: 400 });
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return new Response(JSON.stringify({ error: "Rating must be 1-5" }), { status: 400 });
  }
  // Lightweight spam guard — genuine reviews rarely need to include a link.
  if (URL_PATTERN.test(reviewText) || URL_PATTERN.test(reviewerName)) {
    return new Response(JSON.stringify({ error: "Links are not allowed in reviews" }), { status: 400 });
  }

  if (!(await underRateLimit(env.CLICK_COUNTS, "rl:review:" + clientIp(request), MAX_REVIEWS_PER_IP_PER_HOUR, 3600))) {
    return new Response(JSON.stringify({ error: "Too many reviews from this connection — please try again later." }), { status: 429 });
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const review = {
    id,
    vendor,
    peptide_ordered: peptide || null,
    rating,
    reviewer_name: reviewerName,
    review_text: reviewText,
    date_submitted: new Date().toISOString(),
    status: "pending",
  };

  try {
    await putReview(env.CLICK_COUNTS, review);
  } catch (e) {
    return new Response(JSON.stringify({ error: "Storage error" }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
