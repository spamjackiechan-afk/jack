// GET /api/member-sales — the only place vendor sale promos (data/vendor_sales.json)
// are served. Non-members get { member: false } and no sale data. Members (signed
// cookie + active subscriber, see _lib/membership.js) get the sales list.
// DELETE signs this browser out of member view.

import { currentMember, CLEAR_COOKIE } from "../_lib/membership.js";

export async function onRequestGet(context) {
  let email = null;
  try { email = await currentMember(context); } catch { email = null; }
  if (!email) return json({ member: false });
  let sales = {};
  try {
    const res = await context.env.ASSETS.fetch(new URL("/data/vendor_sales.json", context.request.url));
    if (res.ok) {
      const all = await res.json();
      for (const [k, v] of Object.entries(all || {})) if (!k.startsWith("_")) sales[k] = v;
    }
  } catch { sales = {}; }
  return json({ member: true, vendor_sales: sales });
}

export async function onRequestDelete() {
  return json({ member: false }, 200, { "Set-Cookie": CLEAR_COOKIE });
}

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    // Per-visitor answer: never cache in a shared cache.
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "Vary": "Cookie", ...extra },
  });
}
