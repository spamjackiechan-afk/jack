// Admin-only endpoint for moderating reviews — lists every review
// regardless of status (GET) and updates a review's status (POST).
//
// Password protection works via a SHA-256 hash rather than Cloudflare's
// environment variables UI, since that panel has a known issue recognizing
// zero-config Pages Functions projects (shows "Variables cannot be added
// to a Worker that only has static assets" even when Functions are
// confirmed working, as they are here). Hashing means the real password
// is never stored anywhere — including in this file, which is safe to
// keep in a public repo since only the one-way hash appears below.
//
// To change the password later: generate a new hash for the new password
// and replace ADMIN_PASSWORD_HASH below.

const ADMIN_PASSWORD_HASH = "5e9c17ec33fa2bc25650b1d0fd923675b0409e9dbd00f7a061daf68f22c70bb1";

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function checkAuth(request) {
  const password = request.headers.get("X-Admin-Password");
  if (!password) return false;
  const hash = await sha256Hex(password);
  return hash === ADMIN_PASSWORD_HASH;
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!(await checkAuth(request))) {
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

  if (!(await checkAuth(request))) {
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
