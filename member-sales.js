/* Public vendor sales (shared by index.html and suppliers.html).
 *
 * Vendor sales are shown to EVERY visitor (no membership needed). Sale data
 * comes from /api/member-sales (which now answers for everyone), falling back
 * to the static /data/vendor_sales.json. Only vendors that confirmed tracking
 * and commission are surfaced (SALE_VENDORS); Ride the Tide is allowed except
 * its BOGO code. A sale hides itself once its UTC `end` passes.
 * Pages listen for the "dp-members" event (detail = { member, sales, vendor_sales })
 * and read window.DPMembers.state. (The member cookie code is unused for gating.)
 */
(function(){
  'use strict';
  // Only vendors that confirmed tracking + commission. Never Offline, Licensed,
  // AFA, RPL or Synthrolab.
  var SALE_VENDORS = ['American Peptides', 'Peptide Titans', 'True Peptides', 'Veratis Bio', 'Ride the Tide Peptides', 'Midwest Peptide'];
  function saleAllowed(vendor, s){
    if (SALE_VENDORS.indexOf(vendor) === -1) return false;
    if (vendor === 'Ride the Tide Peptides' && /bogo|buy\s*one,?\s*get\s*one/i.test((s.code || '') + ' ' + (s.gives || ''))) return false;
    return true;
  }
  var state = { member: false, sales: false, vendor_sales: {} };
  var RENDERED_AT = Date.now();

  function esc(s){ var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  // Same visibility rules as the suppliers page: not ended, started, verified within 7 days.
  function activeSales(all){
    var now = Date.now(), out = [];
    Object.keys(all || {}).forEach(function(vendor){
      if (vendor.charAt(0) === '_') return;
      (all[vendor] || []).forEach(function(s){
        if (!s || !saleAllowed(vendor, s)) return;
        if (s.end && Date.parse(s.end) < now) return;
        if (s.start && Date.parse(s.start) > now) return;
        var v = s.verified ? Date.parse(s.verified + 'T00:00:00Z') : NaN;
        if (isNaN(v) || now - v > 7 * 864e5) return;
        out.push({ vendor: vendor, sale: s });
      });
    });
    return out;
  }

  // "Oct 22, 9:59 PM PT"
  function fmtEnd(iso){
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(/\s+/g, ' ') + ' PT';
  }
  // True when the sale text already explains how the discount is applied (automatic,
  // or a code that is revealed elsewhere / not listed), so we add no extra wording.
  function saysAutomatic(s){ return /automatic|applied at checkout|reveal|not listed|no code listed/i.test(s.gives || ''); }

  function injectStyle(){
    if (document.getElementById('dpMembersStyle')) return;
    var st = document.createElement('style');
    st.id = 'dpMembersStyle';
    st.textContent =
      '.dpm-teaser{border:1px dashed var(--rule);border-radius:12px;padding:12px 16px;margin:0 0 20px;display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;font-size:13.5px;color:var(--ink-soft);}' +
      '.dpm-teaser strong{color:var(--ink);font-weight:500;}' +
      '.dpm-btn{background:transparent;border:1.5px solid var(--lowest);color:var(--lowest);font-family:"IBM Plex Mono",monospace;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:7px 12px;border-radius:8px;cursor:pointer;white-space:nowrap;text-decoration:none;}' +
      '.dpm-btn.solid{background:var(--lowest);color:var(--paper);}' +
      '.dpm-link{background:none;border:0;padding:0;color:var(--ink-soft);text-decoration:underline;cursor:pointer;font:inherit;font-size:12.5px;}' +
      '.dpm-form{flex-basis:100%;display:none;gap:8px;flex-wrap:wrap;align-items:center;}' +
      '.dpm-form.open{display:flex;}' +
      '.dpm-form input[type=email]{flex:1;min-width:200px;background:var(--paper);border:1.5px solid var(--rule);color:var(--ink);border-radius:8px;padding:9px 11px;font-size:14px;}' +
      '.dpm-msg{flex-basis:100%;font-family:"IBM Plex Mono",monospace;font-size:12px;min-height:0;}' +
      '.dpm-msg.ok{color:var(--lowest);} .dpm-msg.err{color:var(--amber);}' +
      '.dpm-bar{border:1px solid var(--success);border-radius:12px;padding:12px 16px;margin:0 0 20px;background:linear-gradient(180deg,rgba(232,184,75,.07),transparent);font-size:13.5px;color:var(--ink-soft);}' +
      '.dpm-bar h3{font-family:"Fraunces",serif;font-weight:500;font-size:17px;margin:0 0 4px;color:var(--ink);}' +
      '.dpm-bar ul{margin:8px 0 0;padding-left:18px;} .dpm-bar li{margin:3px 0;}' +
      '.dpm-bar .dpm-code{font-family:"IBM Plex Mono",monospace;color:var(--success);}' +
      '.dpm-bar .dpm-note{font-size:12px;margin-top:6px;}';
    document.head.appendChild(st);
  }

  function joinAction(){
    if (typeof window.openModal === 'function'){ window.openModal('intro'); return; }
    location.href = '/#join';
  }

  function renderSlot(){
    var slot = document.getElementById('memberSalesSlot');
    if (!slot) return;
    injectStyle();
    if (!state.sales){ slot.innerHTML = ''; return; }
    var live = activeSales(state.vendor_sales);
    var items = live.map(function(x){
      var s = x.sale;
      var t = '<strong>' + esc(x.vendor) + '</strong> \u2014 ' + esc(s.gives || 'Sale');
      if (s.code) t += ' \u00b7 code <span class="dpm-code">' + esc(s.code) + '</span>';
      else if (!saysAutomatic(s)) t += ' \u00b7 applied automatically';
      if (s.end) t += ' \u00b7 ends ' + esc(fmtEnd(s.end));
      return '<li>' + t + '</li>';
    }).join('');
    slot.innerHTML =
      '<div class="dpm-bar" id="memberSalesBar">' +
        '<h3>Current vendor sales</h3>' +
        '<div>' + (live.length
          ? 'These are the vendors\u2019 own promos running now, plus any sale prices our daily check saw (marked \u201c% off\u201d on listings).'
          : 'No vendor-run promos are live right now. Sale prices our daily check sees are marked \u201c% off\u201d on listings.') + '</div>' +
        (items ? '<ul>' + items + '</ul>' : '') +
        '<div class="dpm-note">A vendor\u2019s sale code usually replaces our affiliate code at checkout (one code per order unless the vendor says otherwise). Details on <a href="/suppliers" style="color:var(--lowest)">Suppliers</a>.</div>' +
      '</div>';
  }

  function sendLink(){
    var input = document.getElementById('dpmEmail'), msg = document.getElementById('dpmMsg'), btn = document.getElementById('dpmSend');
    var email = (input.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)){ msg.textContent = 'Please enter a valid email address.'; msg.className = 'dpm-msg err'; return; }
    btn.disabled = true; msg.textContent = 'Sending\u2026'; msg.className = 'dpm-msg';
    fetch('/api/member-link', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ email: email, website: (document.getElementById('dpmWebsite') || {}).value || '',
        form_ms: Date.now() - RENDERED_AT, return_to: /suppliers/.test(location.pathname) ? '/suppliers' : '/' })
    }).then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ return { ok: r.ok, j: j }; }); })
      .then(function(x){
        msg.textContent = x.ok ? (x.j.message || 'Check your inbox for a sign-in link.') : (x.j.error || 'Something went wrong \u2014 please try again.');
        msg.className = 'dpm-msg ' + (x.ok ? 'ok' : 'err');
      })
      .catch(function(){ msg.textContent = 'Network error \u2014 please try again.'; msg.className = 'dpm-msg err'; })
      .then(function(){ btn.disabled = false; });
  }

  function apply(next){
    state = { member: Boolean(next && next.member), sales: true, vendor_sales: (next && next.vendor_sales) || {} };
    window.DPMembers.state = state;
    renderSlot();
    try { window.dispatchEvent(new CustomEvent('dp-members', { detail: state })); } catch (e) {}
  }

  function check(){
    function staticSales(member){
      return fetch('/data/vendor_sales.json', { cache: 'no-store' })
        .then(function(r){ return r.ok ? r.json() : {}; })
        .catch(function(){ return {}; })
        .then(function(all){ return { member: member, vendor_sales: all || {} }; });
    }
    return fetch('/api/member-sales', { credentials: 'same-origin', cache: 'no-store' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .catch(function(){ return null; })
      .then(function(j){ return (j && j.vendor_sales) ? j : staticSales(Boolean(j && j.member)); })
      .then(function(j){ apply(j); return state; });
  }

  window.DPMembers = {
    state: state,
    activeSales: activeSales,
    saleAllowed: saleAllowed,
    SALE_VENDORS: SALE_VENDORS,
    fmtEnd: fmtEnd,
    saysAutomatic: saysAutomatic,
    refresh: check,            // call after a successful signup: the cookie is set by /api/subscribe
    ready: null,
  };
  function start(){
    renderSlot();
    window.DPMembers.ready = check();
    // Back from a magic link: drop the ?members=1 marker from the address bar.
    if (/[?&]members=1/.test(location.search) && history.replaceState){
      history.replaceState(null, '', location.pathname + location.hash);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
