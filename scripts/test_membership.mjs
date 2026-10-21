// Unit test for the members-only sales Functions, with an in-memory KV.
// Run: node scripts/test_membership.mjs   (Node 18+; no dependencies)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as subscribe from "../functions/api/subscribe.js";
import * as memberSales from "../functions/api/member-sales.js";
import * as memberLink from "../functions/api/member-link.js";
import * as dataMw from "../functions/data/_middleware.js";

class KV {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  async put(k, v) { this.m.set(k, String(v)); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix }) { return { keys: [...this.m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }; }
}
const SALES = readFileSync(new URL("../data/vendor_sales.json", import.meta.url), "utf8");
const env = {
  CLICK_COUNTS: new KV(),
  ASSETS: { fetch: async () => new Response(SALES, { headers: { "Content-Type": "application/json" } }) },
};
const BASE = "https://discountspeptides.com";
let ip = 0;
const req = (path, { method = "GET", body, cookie } = {}) => new Request(BASE + path, {
  method, body: body ? JSON.stringify(body) : undefined,
  headers: { "Content-Type": "application/json", "CF-Connecting-IP": "10.0.0." + (++ip), ...(cookie ? { Cookie: cookie } : {}) },
});
const cookieOf = res => (res.headers.get("Set-Cookie") || "").split(";")[0];
const ctx = (request, extra = {}) => ({ request, env, ...extra });

// 1. Guest: no sales.
let r = await memberSales.onRequestGet(ctx(req("/api/member-sales")));
assert.deepEqual(await r.json(), { member: false });

// 2. Signup sets a signed HttpOnly cookie that unlocks sales.
r = await subscribe.onRequestPost(ctx(req("/api/subscribe", { method: "POST", body: { email: "A@Example.com", form_ms: 5000 } })));
assert.equal(r.status, 200);
const setCookie = r.headers.get("Set-Cookie");
assert.match(setCookie, /^dp_member_sales=.+HttpOnly; Secure; SameSite=Lax/);
const cookie = cookieOf(r);
r = await memberSales.onRequestGet(ctx(req("/api/member-sales", { cookie })));
let j = await r.json();
assert.equal(j.member, true);
assert.ok(Object.keys(j.vendor_sales).length > 0, "members get vendor_sales");
assert.equal(r.headers.get("Cache-Control"), "private, no-store");

// 3. Tampered cookie is rejected.
const bad = cookie.slice(0, -2) + (cookie.endsWith("AA") ? "BB" : "AA");
j = await (await memberSales.onRequestGet(ctx(req("/api/member-sales", { cookie: bad })))).json();
assert.equal(j.member, false);
// A cookie forged for an address with no signature at all.
j = await (await memberSales.onRequestGet(ctx(req("/api/member-sales", { cookie: "dp_member_sales=" + Buffer.from("x@y.co").toString("base64url") + ".9999999999.sig" })))).json();
assert.equal(j.member, false);

// 4. Static data/vendor_sales.json: 404 for guests, passes through for members.
const next = async () => new Response(SALES);
r = await dataMw.onRequest(ctx(req("/data/vendor_sales.json"), { next }));
assert.equal(r.status, 404);
r = await dataMw.onRequest(ctx(req("/data/vendor_sales.json", { cookie }), { next }));
assert.equal(r.status, 200);
r = await dataMw.onRequest(ctx(req("/data/live_prices.json"), { next }));
assert.equal(r.status, 200);

// 5. Magic link: identical reply for member and non-member; token is single use.
r = await memberLink.onRequestPost(ctx(req("/api/member-link", { method: "POST", body: { email: "a@example.com", form_ms: 5000, return_to: "/suppliers" } })));
const replyMember = await r.json();
r = await memberLink.onRequestPost(ctx(req("/api/member-link", { method: "POST", body: { email: "nobody@example.com", form_ms: 5000 } })));
const replyGuest = await r.json();
assert.deepEqual(replyMember, replyGuest, "reply must not reveal membership");
const tokens = [...env.CLICK_COUNTS.m.keys()].filter(k => k.startsWith("magic:"));
assert.equal(tokens.length, 1, "token only for the real subscriber");
const token = tokens[0].slice("magic:".length);
r = await memberLink.onRequestGet(ctx(req("/api/member-link?token=" + token)));
assert.equal(r.status, 302);
assert.equal(r.headers.get("Location"), "/suppliers?members=1");
const c2 = cookieOf(r);
assert.equal((await (await memberSales.onRequestGet(ctx(req("/api/member-sales", { cookie: c2 })))).json()).member, true);
r = await memberLink.onRequestGet(ctx(req("/api/member-link?token=" + token)));
assert.equal(r.status, 400, "token is one-time");
// Bots (no form timing) are refused.
r = await memberLink.onRequestPost(ctx(req("/api/member-link", { method: "POST", body: { email: "a@example.com" } })));
assert.equal(r.status, 400);

// 6. Unsubscribing ends access on the next check, even with a valid cookie.
r = await subscribe.onRequestGet(ctx(req("/api/subscribe?unsubscribe=a@example.com&token=x")));
assert.equal(r.status, 200);
assert.equal((await (await memberSales.onRequestGet(ctx(req("/api/member-sales", { cookie })))).json()).member, false);

// 7. Signing key comes from MEMBER_COOKIE_SECRET when set.
await subscribe.onRequestPost(ctx(req("/api/subscribe", { method: "POST", body: { email: "a@example.com", form_ms: 5000 } })));
assert.equal((await (await memberSales.onRequestGet(ctx(req("/api/member-sales", { cookie: c2 })))).json()).member, true, "re-subscribed");
env.MEMBER_COOKIE_SECRET = "s3cret";
assert.equal((await (await memberSales.onRequestGet(ctx(req("/api/member-sales", { cookie: c2 })))).json()).member, false, "old-key cookie invalid after key change");

console.log("OK: membership functions test passed");
