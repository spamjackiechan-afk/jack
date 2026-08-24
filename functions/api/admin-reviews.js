// Admin-only endpoint for moderating reviews — lists every review
// regardless of status (GET) and updates a review's status (POST).
//
// Protected by a shared password checked against env.ADMIN_PASSWORD, which
// must be set as an environment variable in the Cloudflare Pages dashboard
// (Settings -> Environment variables -> add ADMIN_PASSWORD, mark it
// "Encrypt" so it's never visible in the dashboard again after saving).
// The password never appears in any client-side code — it's only ever
// checked here, server-side.

function checkAuth(request, env) {
  const password = request.headers.get("X-Admin-Password");
  return password && env.ADMIN_PASSWORD && password === env.ADMIN_PASSWORD;
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let reviews = [];
  try {
    const raw = await env.CLICK_COUNTS.get("reviews");
    reviews = raw ? JSON.parse(raw) : [];
  } catch (e) {
    reviews = [];
  }

  // Most recent first, so new submissions are easy to find.
  reviews.sort((a, b) => new Date(b.date_submitted) - new Date(a.date_submitted));

  return new Response(JSON.stringify(reviews), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!checkAuth(request, env)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const { id, status } = body || {};
  if (!id || !["approved", "rejected"].includes(status)) {
    return new Response(JSON.stringify({ error: "Invalid id or status" }), { status: 400 });
  }

  try {
    const raw = await env.CLICK_COUNTS.get("reviews");
    const reviews = raw ? JSON.parse(raw) : [];
    const review = reviews.find(r => r.id === id);
    if (!review) {
      return new Response(JSON.stringify({ error: "Review not found" }), { status: 404 });
    }
    review.status = status;
    await env.CLICK_COUNTS.put("reviews", JSON.stringify(reviews));
  } catch (e) {
    return new Response(JSON.stringify({ error: "Storage error" }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
