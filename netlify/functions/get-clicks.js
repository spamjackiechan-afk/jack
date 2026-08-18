import { getStore } from "@netlify/blobs";

// Returns every recorded click count as JSON, keyed by "peptide|||vendor".
// The site fetches this once on page load to decide which listings to
// mark as popular — real counts, starting at zero, nothing invented.
export default async (req, context) => {
  const store = getStore({ name: "click-counts", consistency: "strong" });

  let counts = {};
  try {
    counts = (await store.get("counts", { type: "json" })) || {};
  } catch (e) {
    counts = {};
  }

  return new Response(JSON.stringify(counts), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60",
    },
  });
};

export const config = { path: "/api/get-clicks" };
