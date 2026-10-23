// GET /api/member-sales — vendor sale promos (data/vendor_sales.json) for EVERY
// visitor (sales are public). `member` still reports whether this browser has a
// signed member cookie (see _lib/membership.js), but it no longer gates the data.
// DELETE signs this browser out of member view.

import { currentMember, CLEAR_COOKIE } from "../_lib/membership.js";

export async function onRequestGet(context) {
  let email = null;
  try { email = await currentMember(context); } catch { email = null; }
  let sales = {};
  try {
    const res = await context.env.ASSETS.fetch(new URL("/data/vendor_sales.json", context.request.url));
    if (res.ok) {
      const all = await res.json();
      for (const [k, v] of Object.entries(all || {})) if (!k.startsWith("_")) sales[k] = v;
    }
  } catch { sales = {}; }
  return json({ member: Boolean(email), public: true, vendor_sales: sales });
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
