// Returns every APPROVED review as JSON. Pending and rejected reviews are
// never included here — this is the only endpoint the public-facing site
// reads from, so anything not yet approved is simply invisible to visitors.

export async function onRequestGet(context) {
  const { env } = context;

  let reviews = [];
  try {
    const raw = await env.CLICK_COUNTS.get("reviews");
    const all = raw ? JSON.parse(raw) : [];
    reviews = all.filter(r => r.status === "approved");
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
