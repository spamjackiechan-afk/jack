// Stores an email subscription. Deliberately email-only: no phone field.
// SMS marketing in the US falls under the TCPA, which requires prior express
// written consent captured at the moment of collection, with the disclosure
// language retained as evidence. Numbers gathered without that are unusable
// for marketing later, so there is no value in collecting them "for now".
//
// Reuses the CLICK_COUNTS KV namespace, same as the reviews system — no
// additional binding needed. Each subscriber is its own key (sub:<email>);
// older sign-ups may still sit in the single "subscribers" blob, which is
// read as a fallback (functions/_lib/records.js).

import { readSubscriber, putSubscriber, looksAutomated, underRateLimit, clientIp, GENERIC_ERROR } from "../_lib/records.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_FAVOURITES = 200;
const MAX_SIGNUPS_PER_IP_PER_HOUR = 5;

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

  // Honeypot filled in, or sent too fast after the form appeared.
  if (looksAutomated(body)) return json({ error: GENERIC_ERROR }, 400);

  const email = String(body.email || "").trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return json({ error: "Please enter a valid email address" }, 400);
  }

  // Favourites are optional — a visitor can subscribe without saving anything.
  let favourites = Array.isArray(body.favourites) ? body.favourites : [];
  favourites = favourites
    .filter(f => typeof f === "string" && f.length <= 200)
    .slice(0, MAX_FAVOURITES);

  const wantsDeals = body.wants_deals !== false;
  const wantsAlerts = body.wants_alerts !== false;

  try {
    if (!(await underRateLimit(env.CLICK_COUNTS, "rl:sub:" + clientIp(request), MAX_SIGNUPS_PER_IP_PER_HOUR, 3600))) {
      return json({ error: "Too many sign-ups from this connection — please try again later." }, 429);
    }

    const existing = await readSubscriber(env.CLICK_COUNTS, email);
    await putSubscriber(env.CLICK_COUNTS, {
      email,
      favourites,
      wants_deals: wantsDeals,
      wants_price_alerts: wantsAlerts,
      // Consent evidence — retained so there is a record of when and from
      // where someone opted in, which is what CAN-SPAM disputes turn on.
      subscribed_at: existing?.subscribed_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source: String(body.source || "site").slice(0, 60),
      unsubscribed: false,
      // Secret per-subscriber token; unsubscribe links must carry it.
      // Kept when an existing subscriber signs up again, so old links still work.
      unsubscribe_token: existing?.unsubscribe_token || crypto.randomUUID(),
    });
    return json({ ok: true, returning: Boolean(existing) });
  } catch (e) {
    return json({ error: "Could not save — please try again" }, 500);
  }
}

// Unsubscribe: /api/subscribe?unsubscribe=<email>&token=<unsubscribe_token>.
// CAN-SPAM requires a working opt-out honoured within 10 days; this handles
// it immediately. Kept as a GET so it can be reached straight from a link in
// an email without any JavaScript. The token stops anyone unsubscribing
// someone else's address.
//
// Emails sent before tokens existed link to /api/subscribe?unsubscribe=<email>
// with no token, and CAN-SPAM requires an opt-out link to keep working for at
// least 30 days after each email is sent. So while ALLOW_EMAIL_ONLY_UNSUBSCRIBE
// is true, a link with no token (or a wrong one) still unsubscribes the address,
// exactly as before. Only set it to false once every email that went out with
// the old email-only link is more than 30 days old, and every new email uses
// the token link.
const ALLOW_EMAIL_ONLY_UNSUBSCRIBE = true;

export async function onRequestGet(context) {
  const { request, env } = context;
  const params = new URL(request.url).searchParams;
  const email = params.get("unsubscribe");
  const token = params.get("token") || "";
  if (!email) return json({ error: "No email supplied" }, 400);

  try {
    const key = email.trim().toLowerCase();
    const sub = await readSubscriber(env.CLICK_COUNTS, key);
    const tokenOk = Boolean(sub && sub.unsubscribe_token && token && sameString(token, sub.unsubscribe_token));
    if (!tokenOk && !ALLOW_EMAIL_ONLY_UNSUBSCRIBE) {
      // A missing token, a wrong token and an unknown address all get the same
      // reply, so the page doesn't reveal who is on the list.
      return new Response(
        "<html><body style='background:#0E1211;color:#F2F3F1;font-family:sans-serif;padding:60px;text-align:center'>" +
        "<h1 style='font-weight:500'>This unsubscribe link isn't valid.</h1>" +
        "<p style='color:#8A9490'>Please use the unsubscribe link in your most recent email from Discount Peptides.</p>" +
        "<p><a href='/' style='color:#3ED9A6'>Back to the site</a></p></body></html>",
        { status: 400, headers: { "Content-Type": "text/html" } }
      );
    }
    if (sub && !sub.unsubscribed) {
      await putSubscriber(env.CLICK_COUNTS, { ...sub, email: key, unsubscribed: true, unsubscribed_at: new Date().toISOString() });
    }
    // Always report success — confirming whether an address is on the list
    // would leak membership to anyone who guesses.
    return new Response(
      "<html><body style='background:#0E1211;color:#F2F3F1;font-family:sans-serif;padding:60px;text-align:center'>" +
      "<h1 style='font-weight:500'>You're unsubscribed.</h1>" +
      "<p style='color:#8A9490'>You won't receive further emails from Discount Peptides.</p>" +
      "<p><a href='/' style='color:#3ED9A6'>Back to the site</a></p></body></html>",
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  } catch (e) {
    return json({ error: "Could not process" }, 500);
  }
}

function sameString(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
