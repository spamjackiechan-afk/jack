import { getStore } from "@netlify/blobs";

// Records one click for a specific (peptide, vendor) pair. Called from the
// site whenever someone actually follows a "View lowest-priced listing"
// link — not a page view, an actual click-through toward buying.
export default async (req, context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { vendor, peptide } = body || {};

  // Basic sanity checks — reject anything malformed rather than silently
  // storing junk. This isn't real abuse protection, just a floor.
  if (
    !vendor || !peptide ||
    typeof vendor !== "string" || typeof peptide !== "string" ||
    vendor.length > 100 || peptide.length > 150
  ) {
    return new Response("Invalid input", { status: 400 });
  }

  const store = getStore({ name: "click-counts", consistency: "strong" });
  const key = `${peptide}|||${vendor}`;

  try {
    const existing = (await store.get("counts", { type: "json" })) || {};
    existing[key] = (existing[key] || 0) + 1;
    await store.setJSON("counts", existing);
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
};

export const config = { path: "/api/track-click" };
