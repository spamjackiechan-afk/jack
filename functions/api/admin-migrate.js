// One-off, admin-only migration: copies the old single-value blobs into
// per-record keys (see functions/_lib/records.js).
//
//   POST /api/admin-migrate            (X-Admin-Password header, same login as admin-reviews)
//   POST /api/admin-migrate?dry_run=1  reports what it would do, writes nothing
//
// - reviews blob     -> review:<id>      (skips ids that already have a key)
// - subscribers blob -> sub:<email>      (skips existing keys; adds an
//                                         unsubscribe_token to anyone without one)
// - counts blob      -> click:<key>      (adds the old count to the counter,
//                                         then sets migrated:clicks so readers
//                                         stop adding the blob and nothing is
//                                         counted twice; runs only once)
//
// Safe to run more than once. It never deletes the old blobs; whether to
// delete them later is Jackson's call. Do NOT run this on the live site
// until Jackson says so.

import { checkAuth, authError } from "./admin-reviews.js";
import { readJson, putReview, putSubscriber, MIGRATED_CLICKS_KEY } from "../_lib/records.js";

// Stay well inside Cloudflare's per-request limit of 1,000 KV operations.
const MAX_WRITES = 800;

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await checkAuth(request, env);
  if (auth !== "ok") return authError(auth);

  const kv = env.CLICK_COUNTS;
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  const plan = [];
  const summary = { dry_run: dryRun, reviews: 0, subscribers: 0, tokens_added: 0, click_keys: 0, clicks_already_migrated: false };

  const reviews = await readJson(kv, "reviews", []);
  for (const r of Array.isArray(reviews) ? reviews : []) {
    if (!r || !r.id || (await kv.get("review:" + r.id)) !== null) continue;
    plan.push(() => putReview(kv, r));
    summary.reviews++;
  }

  const subs = await readJson(kv, "subscribers", {});
  for (const [email, sub] of Object.entries(subs && typeof subs === "object" ? subs : {})) {
    const existing = await readJson(kv, "sub:" + email);
    if (existing && existing.unsubscribe_token) continue;
    const base = existing || { ...sub, email };
    if (!base.unsubscribe_token) summary.tokens_added++;
    plan.push(() => putSubscriber(kv, { ...base, unsubscribe_token: base.unsubscribe_token || crypto.randomUUID() }));
    summary.subscribers++;
  }

  if (await kv.get(MIGRATED_CLICKS_KEY)) {
    summary.clicks_already_migrated = true;
  } else {
    const counts = await readJson(kv, "counts", {});
    for (const [key, n] of Object.entries(counts && typeof counts === "object" ? counts : {})) {
      const add = parseInt(n, 10) || 0;
      if (!add) continue;
      plan.push(async () => {
        const k = "click:" + key;
        const total = (parseInt((await kv.get(k)) || "0", 10) || 0) + add;
        await kv.put(k, String(total), { metadata: { count: total } });
      });
      summary.click_keys++;
    }
    plan.push(() => kv.put(MIGRATED_CLICKS_KEY, new Date().toISOString()));
  }

  if (plan.length > MAX_WRITES) {
    return json({ error: `Too many records for one run (${plan.length}); nothing written. Split the migration first.`, ...summary }, 413);
  }
  if (!dryRun) {
    for (const step of plan) await step();
  }
  return json({ ok: true, ...summary }, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
