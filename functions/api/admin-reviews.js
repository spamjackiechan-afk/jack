// Admin-only endpoint for moderating reviews — lists every review
// regardless of status (GET) and updates a review's status (POST).
//
// Password protection uses a salted PBKDF2 hash kept in this file rather than
// Cloudflare's environment variables UI, since that panel has a known issue
// recognizing zero-config Pages Functions projects (shows "Variables cannot
// be added to a Worker that only has static assets" even when Functions are
// confirmed working, as they are here). Only the salt and the derived hash
// appear below; the password itself is never stored anywhere.
//
// To change the password: open scripts/make_admin_hash.html locally in your
// own browser, type the new password, and paste the salt + hash it prints
// into ADMIN_PASSWORD_SALT / ADMIN_PASSWORD_PBKDF2 below.
//
// PBKDF2 settings: Cloudflare's Workers runtime refuses more than 100,000
// PBKDF2 iterations in one call, so the key is derived in PBKDF2_ROUNDS
// chained calls of PBKDF2_ITERATIONS each (2 x 100,000 = 200,000 iterations
// of work per guess). scripts/make_admin_hash.html uses the same settings;
// change both together or the hash will not match.
//
// Failed logins are limited per IP (KV key adminfail:<ip>): after
// MAX_FAILURES within 15 minutes, requests get 429 without checking the password.

// Empty until Jackson supplies new values; with them empty, every login fails (fail closed).
const ADMIN_PASSWORD_SALT = "";   // hex, 16 random bytes
const ADMIN_PASSWORD_PBKDF2 = ""; // hex, 32 bytes
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_ROUNDS = 2;
const MAX_FAILURES = 5;
const FAILURE_WINDOW_SECONDS = 900;

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function pbkdf2Hex(password, saltHex) {
  const salt = hexToBytes(saltHex);
  let material = new TextEncoder().encode(password);
  for (let round = 0; round < PBKDF2_ROUNDS; round++) {
    const key = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
      key,
      256
    );
    material = new Uint8Array(bits);
  }
  return bytesToHex(material);
}

// Compares every character so the time taken doesn't reveal how much matched.
function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Returns "ok", "denied" (401) or "limited" (429).
async function checkAuth(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const failKey = "adminfail:" + ip;
  const failures = parseInt((await env.CLICK_COUNTS.get(failKey)) || "0", 10) || 0;
  if (failures >= MAX_FAILURES) return "limited";

  const password = request.headers.get("X-Admin-Password");
  let ok = false;
  if (password && ADMIN_PASSWORD_SALT && ADMIN_PASSWORD_PBKDF2) {
    const hash = await pbkdf2Hex(password, ADMIN_PASSWORD_SALT);
    ok = constantTimeEqual(hash, ADMIN_PASSWORD_PBKDF2.toLowerCase());
  }
  if (ok) return "ok";

  await env.CLICK_COUNTS.put(failKey, String(failures + 1), { expirationTtl: FAILURE_WINDOW_SECONDS });
  return "denied";
}

function authError(result) {
  return result === "limited"
    ? new Response(JSON.stringify({ error: "Too many attempts. Try again later." }), { status: 429 })
    : new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const auth = await checkAuth(request, env);
  if (auth !== "ok") return authError(auth);

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

  const auth = await checkAuth(request, env);
  if (auth !== "ok") return authError(auth);

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
