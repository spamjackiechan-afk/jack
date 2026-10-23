// Returning members on a new device: POST /api/member-link { email, website, form_ms }
// emails a one-time sign-in link (valid 30 minutes) IF the address is an active
// subscriber. The reply is identical either way, so this can't be used to find
// out who is on the list. GET /api/member-link?token=... (the link in the email)
// re-checks the subscriber store, burns the token, sets the long-lived signed
// member cookie and redirects to the page they came from.
//
// Sending: the site had no email sender before this. Mail goes out through
// Resend's HTTP API when these Pages variables are set:
//   RESEND_API_KEY      (encrypted secret)
//   MEMBER_EMAIL_FROM   e.g. "Discount Peptides <members@discountspeptides.com>"
//                       (domain must be verified in Resend)
// Until then the request is accepted but no email is sent (the reply stays the
// same, and the visitor can still unlock by signing up again with that email).

import { readSubscriber, looksAutomated, underRateLimit, clientIp, GENERIC_ERROR } from "../_lib/records.js";
import { isActiveSubscriber, memberCookieHeader, MAGIC_PREFIX, MAGIC_TTL_SECONDS } from "../_lib/membership.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SAME_REPLY = { ok: true, message: "If that address is on our list, a sign-in link is on its way. It works once, for 30 minutes." };
const RETURN_PATHS = new Set(["/", "/suppliers"]);

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
  if (looksAutomated(body)) return json({ error: GENERIC_ERROR }, 400);
  const email = String(body.email || "").trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return json({ error: "Please enter a valid email address" }, 400);
  }
  const back = RETURN_PATHS.has(body.return_to) ? body.return_to : "/";
  try {
    if (!(await underRateLimit(env.CLICK_COUNTS, "rl:mlink:" + clientIp(request), 5, 3600))) {
      return json({ error: "Too many requests from this connection — please try again later." }, 429);
    }
    // Per-address limit too, so nobody can flood someone's inbox. Counted
    // for every address, member or not, so the reply can't leak membership.
    if (!(await underRateLimit(env.CLICK_COUNTS, "rl:mlink-to:" + email, 3, 3600))) return json(SAME_REPLY);

    const sub = await readSubscriber(env.CLICK_COUNTS, email);
    if (isActiveSubscriber(sub)) {
      const token = randomToken();
      await env.CLICK_COUNTS.put(MAGIC_PREFIX + token, JSON.stringify({ email, back }), { expirationTtl: MAGIC_TTL_SECONDS });
      const link = new URL("/api/member-link?token=" + token, request.url).toString();
      await sendLink(env, email, link);
    }
    return json(SAME_REPLY);
  } catch (e) {
    return json({ error: "Could not process — please try again" }, 500);
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const token = new URL(request.url).searchParams.get("token") || "";
  if (/^[A-Za-z0-9_-]{20,80}$/.test(token)) {
    try {
      const key = MAGIC_PREFIX + token;
      const raw = await env.CLICK_COUNTS.get(key);
      if (raw) {
        await env.CLICK_COUNTS.delete(key); // one use only
        const { email, back } = JSON.parse(raw);
        const sub = await readSubscriber(env.CLICK_COUNTS, email);
        if (isActiveSubscriber(sub)) {
          const dest = (RETURN_PATHS.has(back) ? back : "/") + "?members=1";
          return new Response(null, {
            status: 302,
            headers: { Location: dest, "Set-Cookie": await memberCookieHeader(env, email), "Cache-Control": "no-store" },
          });
        }
      }
    } catch (e) { /* fall through to the invalid page */ }
  }
  return new Response(
    "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head>" +
    "<body style='background:#0E1211;color:#F2F3F1;font-family:sans-serif;padding:60px 24px;text-align:center'>" +
    "<h1 style='font-weight:500'>This sign-in link has expired or was already used.</h1>" +
    "<p style='color:#8A9490'>Ask for a new one from \u201cMembers: see sales\u201d on the site.</p>" +
    "<p><a href='/' style='color:#3ED9A6'>Back to the site</a></p></body></html>",
    { status: 400, headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } }
  );
}

function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sendLink(env, email, link) {
  if (!env.RESEND_API_KEY || !env.MEMBER_EMAIL_FROM) return false;
  const text =
    "Here is your Discount Peptides member link. It shows current vendor sales on this browser.\n\n" +
    link + "\n\nIt works once and expires in 30 minutes. If you didn't ask for it, ignore this email.\n\n" +
    "Research use only. Not for human or animal consumption.";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.MEMBER_EMAIL_FROM, to: [email], subject: "Your Discount Peptides member link", text }),
  });
  return res.ok;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
