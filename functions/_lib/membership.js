// Members-only sales: membership = an active (not unsubscribed) record in the
// existing subscriber store (sub:<email> in CLICK_COUNTS, see records.js).
// No passwords. A member's browser holds a long-lived HMAC-signed cookie;
// every request that reveals sale data re-checks the subscriber store, so an
// unsubscribe ends access on the next page load.
// (No onRequest* exports, so this file is not a route.)
//
// Signing key: env.MEMBER_COOKIE_SECRET if set (Pages > Settings > Variables,
// encrypted). Otherwise a random key is generated once and kept in KV under
// SECRET_KEY, so the feature works with no setup.

import { readSubscriber } from "./records.js";

export const COOKIE_NAME = "dp_member_sales";
export const COOKIE_MAX_AGE = 400 * 24 * 3600; // browsers cap cookies at 400 days
const SECRET_KEY = "secret:member_cookie";
export const MAGIC_PREFIX = "magic:";
export const MAGIC_TTL_SECONDS = 30 * 60;

const enc = new TextEncoder();

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlText(text) { return b64url(enc.encode(text)); }
function fromB64urlText(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

async function secret(env) {
  if (env.MEMBER_COOKIE_SECRET) return env.MEMBER_COOKIE_SECRET;
  const kv = env.CLICK_COUNTS;
  let s = await kv.get(SECRET_KEY);
  if (!s) {
    s = b64url(crypto.getRandomValues(new Uint8Array(32)));
    await kv.put(SECRET_KEY, s);
  }
  return s;
}

async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data))));
}

export function sameString(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Cookie value: base64url(email) "." expiry-seconds "." signature
export async function signMember(env, email, nowMs = Date.now()) {
  const exp = Math.floor(nowMs / 1000) + COOKIE_MAX_AGE;
  const body = b64urlText(email) + "." + exp;
  return body + "." + (await hmac(await secret(env), "member|" + body));
}

// Email from a valid, unexpired cookie value, or null. Signature only.
export async function verifyMemberValue(env, value, nowMs = Date.now()) {
  const parts = String(value || "").split(".");
  if (parts.length !== 3) return null;
  const [e, exp, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) * 1000 < nowMs) return null;
  if (!sameString(sig, await hmac(await secret(env), "member|" + e + "." + exp))) return null;
  try { return fromB64urlText(e); } catch { return null; }
}

export function readCookie(request, name = COOKIE_NAME) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export async function memberCookieHeader(env, email) {
  return `${COOKIE_NAME}=${await signMember(env, email)}; Max-Age=${COOKIE_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
export const CLEAR_COOKIE = `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;

export function isActiveSubscriber(sub) {
  return Boolean(sub && !sub.unsubscribed);
}

// Server-side membership check: valid signature AND still an active subscriber.
export async function currentMember(context) {
  const { request, env } = context;
  const email = await verifyMemberValue(env, readCookie(request));
  if (!email) return null;
  const sub = await readSubscriber(env.CLICK_COUNTS, email);
  return isActiveSubscriber(sub) ? email : null;
}
