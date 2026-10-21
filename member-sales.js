/* Members-only sales (shared by index.html and suppliers.html).
 *
 * Vendor sales are shown only to members of the email list. Membership is
 * checked server-side by /api/member-sales (signed HttpOnly cookie + an active
 * record in the subscriber store); this script never decides it on its own.
 *   - Guests: a small "Members see current vendor sales — join free" teaser in
 *     #memberSalesSlot, with a "Members: see sales" form that emails a
 *     one-time sign-in link (/api/member-link).
 *   - Members: a bar listing the vendor-run sales currently live.
 * Pages listen for the "dp-members" event (detail = { member, vendor_sales })
 * and read window.DPMembers.state. No sale amounts appear in guest markup.
 */
(function(){
  'use strict';
  var OFFLINE = 'Offline Peptides'; // standing rule: never surface Offline deals/sales
  var state = { member: false, vendor_sales: {} };
  var RENDERED_AT = Date.now();

  function esc(s){ var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  // Same visibility rules as the suppliers page: not ended, started, verified within 7 days.
  function activeSales(all){
    var now = Date.now(), out = [];
    Object.keys(all || {}).forEach(function(vendor){
      if (vendor === OFFLINE || vendor.charAt(0) === '_') return;
      (all[vendor] || []).forEach(function(s){
        if (!s) return;
        if (s.end && Date.parse(s.end) < now) return;
        if (s.start && Date.parse(s.start) > now) return;
        var v = s.verified ? Date.parse(s.verified + 'T00:00:00Z') : NaN;
        if (isNaN(v) || now - v > 7 * 864e5) return;
        out.push({ vendor: vendor, sale: s });
      });
    });
    return out;
  }

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
    if (!state.member){
      slot.innerHTML =
        '<div class="dpm-teaser" id="memberTeaser">' +
          
          '<span><strong>Members see current vendor sales</strong> \u2014 join free with your email.</span>' +
          '<button type="button" class="dpm-btn solid" id="dpmJoin">Join free</button>' +
          '<button type="button" class="dpm-link" id="dpmToggle" aria-expanded="false" aria-controls="dpmForm">Members: see sales</button>' +
          '<div class="dpm-form" id="dpmForm">' +
            '<input type="email" id="dpmEmail" placeholder="Your member email" autocomplete="email" aria-label="Member email">' +
            '<div aria-hidden="true" style="position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden;"><input type="text" id="dpmWebsite" tabindex="-1" autocomplete="off"></div>' +
            '<button type="button" class="dpm-btn" id="dpmSend">Email me a link</button>' +
            '<div class="dpm-msg" id="dpmMsg"></div>' +
          '</div>' +
        '</div>';
      document.getElementById('dpmJoin').onclick = joinAction;
      document.getElementById('dpmToggle').onclick = function(){
        var f = document.getElementById('dpmForm');
        var open = f.classList.toggle('open');
        this.setAttribute('aria-expanded', open);
        if (open) document.getElementById('dpmEmail').focus();
      };
      document.getElementById('dpmSend').onclick = sendLink;
      document.getElementById('dpmEmail').addEventListener('keydown', function(e){ if (e.key === 'Enter') sendLink(); });
      return;
    }
    var live = activeSales(state.vendor_sales);
    var items = live.map(function(x){
      var s = x.sale;
      var t = '<strong>' + esc(x.vendor) + '</strong> \u2014 ' + esc(s.gives || 'Sale');
      t += s.code ? ' \u00b7 code <span class="dpm-code">' + esc(s.code) + '</span>' : ' \u00b7 applied automatically';
      if (s.end) t += ' \u00b7 ends ' + esc(new Date(s.end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      return '<li>' + t + '</li>';
    }).join('');
    slot.innerHTML =
      '<div class="dpm-bar" id="memberSalesBar">' +
        '<h3>Member sales</h3>' +
        '<div>Thanks for being a member. ' + (live.length
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
    state = { member: Boolean(next && next.member), vendor_sales: (next && next.vendor_sales) || {} };
    window.DPMembers.state = state;
    document.documentElement.classList.toggle('dp-sales-member', state.member);
    renderSlot();
    try { window.dispatchEvent(new CustomEvent('dp-members', { detail: state })); } catch (e) {}
  }

  function check(){
    return fetch('/api/member-sales', { credentials: 'same-origin', cache: 'no-store' })
      .then(function(r){ return r.ok ? r.json() : { member: false }; })
      .catch(function(){ return { member: false }; })
      .then(function(j){ apply(j && j.member ? j : { member: false }); return state; });
  }

  window.DPMembers = {
    state: state,
    activeSales: activeSales,
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
