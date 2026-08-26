// Stores an email subscription. Deliberately email-only: no phone field.
// SMS marketing in the US falls under the TCPA, which requires prior express
// written consent captured at the moment of collection, with the disclosure
// language retained as evidence. Numbers gathered without that are unusable
// for marketing later, so there is no value in collecting them "for now".
//
// Reuses the CLICK_COUNTS KV namespace under a "subscribers" key, same as
// the reviews system — no additional binding needed.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_FAVOURITES = 200;

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

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
    const raw = await env.CLICK_COUNTS.get("subscribers");
    const subs = raw ? JSON.parse(raw) : {};

    const existing = subs[email];
    subs[email] = {
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
    };

    await env.CLICK_COUNTS.put("subscribers", JSON.stringify(subs));
    return json({ ok: true, returning: Boolean(existing) });
  } catch (e) {
    return json({ error: "Could not save — please try again" }, 500);
  }
}

// Unsubscribe by email. CAN-SPAM requires a working opt-out honoured within
// 10 days; this handles it immediately. Kept as a GET so it can be reached
// straight from a link in an email without any JavaScript.
export async function onRequestGet(context) {
  const { request, env } = context;
  const email = new URL(request.url).searchParams.get("unsubscribe");
  if (!email) return json({ error: "No email supplied" }, 400);

  try {
    const raw = await env.CLICK_COUNTS.get("subscribers");
    const subs = raw ? JSON.parse(raw) : {};
    const key = email.trim().toLowerCase();
    if (subs[key]) {
      subs[key].unsubscribed = true;
      subs[key].unsubscribed_at = new Date().toISOString();
      await env.CLICK_COUNTS.put("subscribers", JSON.stringify(subs));
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

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
