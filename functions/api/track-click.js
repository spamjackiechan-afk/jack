// Records one click for a specific (peptide, vendor) pair. Called from the
// site whenever someone actually follows a "View lowest-priced listing"
// link — not a page view, an actual click-through toward buying.
//
// Requires a KV namespace bound to this project with the variable name
// CLICK_COUNTS (Settings -> Bindings -> Add -> KV namespace, in the
// Cloudflare Pages dashboard).

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
    const raw = await env.CLICK_COUNTS.get("counts");
    const existing = raw ? JSON.parse(raw) : {};
    existing[key] = (existing[key] || 0) + 1;
    await env.CLICK_COUNTS.put("counts", JSON.stringify(existing));
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
