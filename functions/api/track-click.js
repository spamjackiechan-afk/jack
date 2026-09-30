// Records one click for a specific (peptide, vendor) pair. Called from the
// site whenever someone actually follows a "View lowest-priced listing"
// link — not a page view, an actual click-through toward buying.
//
// Requires a KV namespace bound to this project with the variable name
// CLICK_COUNTS (Settings -> Bindings -> Add -> KV namespace, in the
// Cloudflare Pages dashboard).
//
// Each pair has its own counter key (click:<peptide>|||<vendor>), so two
// clicks at once can only clash on that one counter, not wipe out others.

import { incrementClick } from "../_lib/records.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { vendor, peptide } = body || {};

  if (
    !vendor || !peptide ||
    typeof vendor !== "string" || typeof peptide !== "string" ||
    vendor.length > 100 || peptide.length > 150
  ) {
    return new Response("Invalid input", { status: 400 });
  }

  const key = `${peptide}|||${vendor}`;

  try {
    await incrementClick(env.CLICK_COUNTS, key);
  } catch (e) {
    return new Response("Storage error", { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
