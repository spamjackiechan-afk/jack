// Shared KV helpers for reviews, subscribers and click counts.
// (No onRequest* exports, so this file is not a route; the API files import it.)
//
// New data is stored ONE KEY PER RECORD, so two requests at the same moment
// can no longer overwrite each other's review or subscriber:
//   review:<id>                      JSON review (metadata: { status })
//   sub:<email>                      JSON subscriber (includes unsubscribe_token)
//   click:<peptide>|||<vendor>       count as text (metadata: { count })
//
// Old data lives in three single-value blobs: "reviews" (array),
// "subscribers" (object keyed by email) and "counts" (object). Nothing here
// deletes them. Readers merge the blobs with the per-record keys so no
// existing data disappears; a per-record key wins over the same record in
// a blob because it is newer. functions/api/admin-migrate.js copies the blobs
// into per-record keys (admin-only, run once, on Jackson's say-so).

export const MIGRATED_CLICKS_KEY = "migrated:clicks";
// Saved copy of the public (approved) reviews, exactly what get-reviews
// returns. Rewritten only by admin-reviews.js (approve/reject) and by
// admin-migrate.js, so get-reviews never needs a KV list request.
export const REVIEWS_SNAPSHOT_KEY = "reviews:approved_snapshot";

export async function listKeys(kv, prefix) {
  const keys = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor });
    keys.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

export async function readJson(kv, key, fallback = null) {
  try {
    const raw = await kv.get(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

// ---- Reviews
export function putReview(kv, review) {
  return kv.put("review:" + review.id, JSON.stringify(review), { metadata: { status: review.status } });
}

// Every review, old blob + per-record keys merged by id (per-record wins).
// With onlyStatus set, per-record reviews whose metadata says another status
// are skipped without being fetched, and the result is filtered to that status.
export async function readReviews(kv, onlyStatus) {
  const byId = new Map();
  const blob = await readJson(kv, "reviews", []);
  for (const r of Array.isArray(blob) ? blob : []) if (r && r.id) byId.set(r.id, r);
  for (const k of await listKeys(kv, "review:")) {
    const id = k.name.slice("review:".length);
    if (onlyStatus && k.metadata && k.metadata.status && k.metadata.status !== onlyStatus) {
      byId.delete(id);
      continue;
    }
    const r = await readJson(kv, k.name);
    if (r) byId.set(id, r);
  }
  const all = [...byId.values()];
  return onlyStatus ? all.filter(r => r.status === onlyStatus) : all;
}

// Rebuilds the approved-reviews snapshot from the old blob + review:* keys.
// Admin-only callers (a list request is fine there). Returns how many.
export async function rebuildReviewsSnapshot(kv) {
  const approved = await readReviews(kv, "approved");
  await kv.put(REVIEWS_SNAPSHOT_KEY, JSON.stringify(approved));
  return approved.length;
}

// Approved reviews from the old "reviews" blob only ([] if missing/unreadable).
export async function approvedFromBlob(kv) {
  const blob = await readJson(kv, "reviews", []);
  return (Array.isArray(blob) ? blob : []).filter(r => r && r.status === "approved");
}

// ---- Subscribers
export function putSubscriber(kv, sub) {
  return kv.put("sub:" + sub.email, JSON.stringify(sub));
}

// One subscriber: per-record key first, then the old blob.
export async function readSubscriber(kv, email) {
  const rec = await readJson(kv, "sub:" + email);
  if (rec) return rec;
  const blob = await readJson(kv, "subscribers", {});
  return (blob && blob[email]) || null;
}

// ---- Click counts
// Keeps migrated_old (set by admin-migrate.js in the same write that added
// the old blob count) so a re-run migration can't add that count twice.
export async function incrementClick(kv, key) {
  const k = "click:" + key;
  const { value, metadata } = await kv.getWithMetadata(k);
  const n = (parseInt(value || "0", 10) || 0) + 1;
  const meta = { count: n };
  if (metadata && metadata.migrated_old != null) meta.migrated_old = metadata.migrated_old;
  await kv.put(k, String(n), { metadata: meta });
}

// All counts keyed "peptide|||vendor". Until the migration has copied the
// old "counts" blob into click:* keys, the blob is added in; afterwards it
// is skipped so nothing is counted twice.
export async function readClickCounts(kv) {
  const migrated = Boolean(await kv.get(MIGRATED_CLICKS_KEY));
  const counts = migrated ? {} : { ...(await readJson(kv, "counts", {})) };
  // A failed list throws; get-clicks.js then falls back to the old blob.
  for (const k of await listKeys(kv, "click:")) {
    const key = k.name.slice("click:".length);
    let n = k.metadata && Number.isFinite(k.metadata.count) ? k.metadata.count : null;
    if (n == null) n = parseInt((await kv.get(k.name)) || "0", 10) || 0;
    // A counter the migration already handled includes its old blob count.
    const done = k.metadata && k.metadata.migrated_old != null;
    counts[key] = done ? n : (counts[key] || 0) + n;
  }
  return counts;
}

// ---- Spam protection (review + subscribe forms)
export const GENERIC_ERROR = "Something went wrong — please try again.";
const MIN_FORM_MS = 3000;

// True when the submission looks automated: the hidden "website" honeypot
// was filled in, or the form was sent less than 3 seconds after it rendered.
// form_ms is measured in the visitor's browser (now minus the render time),
// so a wrong clock on their computer can't cause false rejections.
export function looksAutomated(body) {
  if (String((body && body.website) || "").trim() !== "") return true;
  const ms = Number(body && body.form_ms);
  return !Number.isFinite(ms) || ms < MIN_FORM_MS;
}

// Per-IP limit. Returns true (and counts this one) if still under `max`
// within the window; false if the limit is already reached.
export async function underRateLimit(kv, key, max, windowSeconds) {
  const n = parseInt((await kv.get(key)) || "0", 10) || 0;
  if (n >= max) return false;
  await kv.put(key, String(n + 1), { expirationTtl: windowSeconds });
  return true;
}

export function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}
