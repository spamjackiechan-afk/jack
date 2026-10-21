// data/vendor_sales.json is members-only: the raw static file is not served to
// the public (members get it through /api/member-sales). Every other /data/*
// file passes straight through.
import { currentMember } from "../_lib/membership.js";

export async function onRequest(context) {
  const path = new URL(context.request.url).pathname;
  if (path === "/data/vendor_sales.json" || path === "/data/vendor_sales") {
    let ok = false;
    try { ok = Boolean(await currentMember(context)); } catch { ok = false; }
    if (!ok) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    const res = await context.next();
    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", "private, no-store");
    return out;
  }
  return context.next();
}
