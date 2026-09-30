// Admin-only migration: copies the old single-value blobs into per-record
// keys (see functions/_lib/records.js), in batches.
//
//   POST /api/admin-migrate                  (X-Admin-Password header, same login as admin-reviews)
//   POST /api/admin-migrate?cursor=<next>    continue where the last run stopped
//   POST /api/admin-migrate?dry_run=1        writes nothing; reports the plan
//
// Order: reviews blob -> review:<id>, subscribers blob -> sub:<email> (adds an
// unsubscribe_token where missing), counts blob -> click:<key>, then the
// migrated:clicks flag, then the public reviews snapshot.
//
// Each request stops before it would pass OP_BUDGET KV operations (reads,
// writes and lists, including the login check), well under Cloudflare's
// 1,000 per request, and returns complete: false plus next_cursor. Re-running
// with next_cursor continues; re-running with no cursor is also safe: records
// that already have their per-record key (and subscribers with a token) are
// skipped, and each click counter is marked done in the same write that adds
// its old count, so it can never be added twice.
//
// Free plan: 1,000 KV writes per day for everything (clicks, sign-ups too).
// Check writes_this_run and spread batches over several days if needed.
// It never deletes the old blobs. Do NOT run this on the live site until
// Jackson says so.

import { checkAuth, authError } from "./admin-reviews.js";
import { readJson, putReview, putSubscriber, listKeys, rebuildReviewsSnapshot, MIGRATED_CLICKS_KEY } from "../_lib/records.js";

export const OP_BUDGET = 800;
const AUTH_OPS = 1; // checkAuth reads adminfail:<ip>
const PHASES = ["reviews", "subscribers", "clicks", "flag", "snapshot"];
const RECORD_STEP_OPS = 2; // one read to check, at most one write

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await checkAuth(request, env);
  if (auth !== "ok") return authError(auth);

  const url = new URL(request.url);
  const result = await migrate(env.CLICK_COUNTS, {
    dryRun: url.searchParams.get("dry_run") === "1",
    cursor: url.searchParams.get("cursor") || "",
    budget: OP_BUDGET - AUTH_OPS,
  });
  result.ops.budget += AUTH_OPS;
  result.ops.used += AUTH_OPS;
  return json(result, result.bad_cursor ? 400 : result.error ? 500 : 200);
}

// Strict JSON read: a failed read throws instead of looking like "missing",
// so an existing record is never overwritten because of a read error.
async function getJsonStrict(kv, key) {
  const raw = await kv.get(key);
  return raw === null ? null : JSON.parse(raw);
}

export async function migrate(rawKv, { dryRun = false, cursor = "", budget = OP_BUDGET - AUTH_OPS } = {}) {
  const ops = { reads: 0, writes: 0, lists: 0 }; // attempts, for the per-request budget
  let written = 0; // successful writes, for the daily write limit
  const used = () => ops.reads + ops.writes + ops.lists;
  const fits = n => used() + n <= budget;
  // Counts every KV operation; in a dry run, writes are skipped.
  const kv = {
    get: (k, o) => { ops.reads++; return rawKv.get(k, o); },
    getWithMetadata: (k, o) => { ops.reads++; return rawKv.getWithMetadata(k, o); },
    list: o => { ops.lists++; return rawKv.list(o); },
    put: async (k, v, o) => { if (dryRun) return; ops.writes++; await rawKv.put(k, v, o); written++; },
  };

  const m = /^(reviews|subscribers|clicks|flag|snapshot):(\d+)$/.exec(cursor || "reviews:0");
  if (!m) return { ok: false, bad_cursor: true, error: "Invalid cursor", ops: { budget, used: 0, ...ops } };
  let phaseIdx = PHASES.indexOf(m[1]);
  let offset = parseInt(m[2], 10);

  const done = { reviews_copied: 0, reviews_skipped: 0, subscribers_copied: 0, tokens_added: 0, subscribers_skipped: 0, clicks_migrated: 0, clicks_skipped: 0, flag_set: false, snapshot_reviews: null };
  let stopped = null;
  let error = null;
  let items = { reviews: [], subscribers: [], clicks: [] };
  let clicksDone = false;
  let snapshotOps = 0;

  try {
    // Fixed reads: the three old blobs and the clicks flag. Nothing writes the
    // blobs any more, so their order (and so the cursor offsets) is stable.
    const reviewsBlob = await readJson(kv, "reviews", []);
    items.reviews = Array.isArray(reviewsBlob) ? reviewsBlob : [];
    const subsBlob = await readJson(kv, "subscribers", {});
    items.subscribers = Object.entries(subsBlob && typeof subsBlob === "object" ? subsBlob : {});
    clicksDone = Boolean(await kv.get(MIGRATED_CLICKS_KEY));
    if (!clicksDone) {
      const countsBlob = await readJson(kv, "counts", {});
      items.clicks = Object.entries(countsBlob && typeof countsBlob === "object" ? countsBlob : {})
        .filter(([, n]) => (parseInt(n, 10) || 0) > 0);
    }

    const steps = {
      async reviews(r) {
        if (!r || !r.id || (await kv.get("review:" + r.id)) !== null) return done.reviews_skipped++;
        await putReview(kv, r);
        done.reviews_copied++;
      },
      async subscribers([email, sub]) {
        const existing = await getJsonStrict(kv, "sub:" + email);
        if (existing && existing.unsubscribe_token) return done.subscribers_skipped++;
        const base = existing || { ...sub, email };
        if (!base.unsubscribe_token) done.tokens_added++;
        await putSubscriber(kv, { ...base, unsubscribe_token: base.unsubscribe_token || crypto.randomUUID() });
        done.subscribers_copied++;
      },
      async clicks([key, old]) {
        const k = "click:" + key;
        const { value, metadata } = await kv.getWithMetadata(k);
        if (metadata && metadata.migrated_old != null) return done.clicks_skipped++;
        const add = parseInt(old, 10) || 0;
        const total = (parseInt(value || "0", 10) || 0) + add;
        // The new total and the "done" marker go in ONE write, so it either
        // lands completely or not at all: a re-run can't add the old count twice.
        await kv.put(k, String(total), { metadata: { count: total, migrated_old: add } });
        done.clicks_migrated++;
      },
    };

    outer:
    for (; phaseIdx < PHASES.length; phaseIdx++, offset = 0) {
      const phase = PHASES[phaseIdx];
      if (phase === "flag") {
        if (clicksDone) continue;
        if (!fits(1)) { stopped = "flag:0"; break; }
        await kv.put(MIGRATED_CLICKS_KEY, new Date().toISOString());
        if (!dryRun) done.flag_set = true;
        continue;
      }
      if (phase === "snapshot") {
        if (!fits(1)) { stopped = "snapshot:0"; break; }
        // Size the rebuild first: a list, the blob, each approved review:* key, one write.
        const keys = await listKeys(kv, "review:");
        const approvedKeys = keys.filter(k => !k.metadata || !k.metadata.status || k.metadata.status === "approved").length;
        const toCopy = dryRun ? items.reviews.filter(r => r && r.status === "approved").length : 0;
        snapshotOps = Math.max(1, Math.ceil(keys.length / 1000)) + 1 + approvedKeys + toCopy + 1;
        if (!fits(snapshotOps)) {
          if (snapshotOps > budget - 5) throw new Error(`Snapshot needs ~${snapshotOps} KV operations, more than one request allows.`);
          stopped = "snapshot:0";
          break;
        }
        if (!dryRun) done.snapshot_reviews = await rebuildReviewsSnapshot(kv);
        continue;
      }
      const list = items[phase];
      for (; offset < list.length; offset++) {
        if (!fits(RECORD_STEP_OPS)) { stopped = `${phase}:${offset}`; break outer; }
        await steps[phase](list[offset]);
      }
    }
  } catch (e) {
    error = String((e && e.message) || e);
    stopped = `${PHASES[Math.min(phaseIdx, PHASES.length - 1)]}:${offset}`;
  }

  const at = stopped ? PHASES.indexOf(stopped.split(":")[0]) : PHASES.length;
  const atOffset = stopped ? parseInt(stopped.split(":")[1], 10) : 0;
  const left = (phase) => {
    const i = PHASES.indexOf(phase);
    return i < at ? 0 : i === at ? items[phase].length - atOffset : items[phase].length;
  };
  const remaining = { reviews: left("reviews"), subscribers: left("subscribers"), clicks: left("clicks"), flag: !clicksDone && !done.flag_set, snapshot: at <= PHASES.indexOf("snapshot") || dryRun };

  const result = {
    ok: !error,
    dry_run: dryRun,
    complete: !error && !stopped,
    next_cursor: stopped, // pass back as ?cursor=... to continue
    done,
    remaining,
    ops: { budget, used: used(), ...ops },
    writes_this_run: written,
    daily_write_note: "Free plan: 1,000 KV writes/day in total (clicks, sign-ups, reviews too). If needed, continue with next_cursor on another day.",
  };
  if (error) result.error = error;
  if (dryRun) {
    // Writes the checked records need, plus every unchecked one (upper bound).
    const recWrites = done.reviews_copied + done.subscribers_copied + done.clicks_migrated
      + remaining.reviews + remaining.subscribers + remaining.clicks;
    const records = items.reviews.length + items.subscribers.length + items.clicks.length;
    const flagWrites = clicksDone ? 0 : 1;
    const snapOps = snapshotOps || (2 + items.reviews.filter(r => r && r.status === "approved").length + 1);
    const perRun = budget - 5;
    const batches = Math.max(1, Math.ceil((records + recWrites + flagWrites + snapOps) / perRun));
    result.plan = {
      reviews_to_copy: done.reviews_copied + remaining.reviews,
      subscribers_to_copy: done.subscribers_copied + remaining.subscribers,
      tokens_to_add_checked: done.tokens_added,
      click_counters_to_migrate: done.clicks_migrated + remaining.clicks,
      estimated_writes: recWrites + flagWrites + 1,
      estimated_reads: records + (snapOps - 2) + 5 * batches, // + login and blob reads per batch
      estimated_batches: batches,
      estimate_is_upper_bound: Boolean(stopped),
    };
  }
  return result;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
