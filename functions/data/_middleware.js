// Vendor sales are public again (data/vendor_sales.json is served to every
// visitor). The member cookie code in ../_lib/membership.js stays in place but
// no longer gates anything here. Every /data/* file passes straight through.
export async function onRequest(context) {
  return context.next();
}
