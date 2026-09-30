/* Google Analytics (GA4), consent first. Loaded (defer) on the public pages
 * only: index, about, suppliers, testing, privacy. Not on admin-reviews.html
 * or anything under functions/.
 *
 * - Nothing is requested from Google until the visitor clicks Accept.
 *   Consent Mode defaults are all "denied"; Accept grants analytics_storage
 *   only. The three ad_* types stay denied for good (no ads on this site).
 * - The choice is kept in localStorage "dp_consent" ("granted" / "denied").
 *   No saved choice (or storage blocked) = show the banner.
 * - page_location sent to Google keeps only ?q, ?category and ?vendor, and
 *   drops any of them that looks like personal data (an @, a phone-like run
 *   of 7+ digits, or over 100 characters). Google's policy: no PII in URLs.
 * - "Cookie settings" links (data-dp-cookie-settings) clear the choice and
 *   reopen the banner. Declining after accepting switches GA off on this page
 *   and deletes its _ga cookies.
 * - window.dp_ga_loaded is true only while GA is running with consent;
 *   trackClick() in index.html checks it before sending affiliate_click.
 * Every step is wrapped so this file can never break the page.
 * The Measurement ID lives only here (smoke_test.py checks that).
 */
(function () {
  'use strict';
  var GA_ID = 'G-CYYYPQ5ZDX';
  var KEY = 'dp_consent';
  var KEEP_PARAMS = ['q', 'category', 'vendor'];
  var w = window, d = document;
  var injected = false, banner = null;

  // 1) dataLayer + gtag + Consent Mode defaults (all denied), before anything else.
  try {
    w.dataLayer = w.dataLayer || [];
    if (typeof w.gtag !== 'function') w.gtag = function () { w.dataLayer.push(arguments); };
    w.gtag('consent', 'default', {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied'
    });
  } catch (e) {}

  function getChoice() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function setChoice(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function clearChoice() { try { localStorage.removeItem(KEY); } catch (e) {} }

  function looksPersonal(v) {
    return v.indexOf('@') !== -1 || v.length > 100 || /(\d[\s().+-]*){7,}/.test(v);
  }

  // origin + pathname + only the kept params (never the #hash).
  function cleanUrl(href) {
    try {
      var u = new URL(href, location.href);
      if (u.origin !== location.origin) return u.origin + u.pathname;
      var out = new URLSearchParams();
      KEEP_PARAMS.forEach(function (k) {
        var v = u.searchParams.get(k);
        if (v != null && v !== '' && !looksPersonal(v)) out.set(k, v);
      });
      var qs = out.toString();
      return u.origin + u.pathname + (qs ? '?' + qs : '');
    } catch (e) {
      return location.origin + location.pathname;
    }
  }

  // 2) Loader: runs only after Accept (now or on an earlier visit).
  function loadGa() {
    try {
      w['ga-disable-' + GA_ID] = false;
      w.gtag('consent', 'update', { analytics_storage: 'granted' });
      if (!injected) {
        injected = true;
        var s = d.createElement('script');
        s.async = true;
        s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
        (d.head || d.documentElement).appendChild(s);
        w.gtag('js', new Date());
        var cfg = {
          page_location: cleanUrl(location.href),
          allow_google_signals: false,
          allow_ad_personalization_signals: false
        };
        if (d.referrer) cfg.page_referrer = cleanUrl(d.referrer);
        w.gtag('config', GA_ID, cfg);
      }
      w.dp_ga_loaded = true;
    } catch (e) {}
  }

  // Decline after accepting (via Cookie settings): stop GA and drop its cookies.
  function stopGa() {
    w.dp_ga_loaded = false;
    try {
      w['ga-disable-' + GA_ID] = true;
      w.gtag('consent', 'update', { analytics_storage: 'denied' });
      var parts = location.hostname.split('.');
      d.cookie.split(';').forEach(function (c) {
        var name = c.split('=')[0].trim();
        if (!/^_ga(_|$)/.test(name)) return;
        d.cookie = name + '=; Max-Age=0; path=/';
        for (var i = 0; i < parts.length - 1; i++) {
          d.cookie = name + '=; Max-Age=0; path=/; domain=.' + parts.slice(i).join('.');
        }
      });
    } catch (e) {}
  }

  // 3) Banner (built on demand; phone-first).
  var CSS =
    '#dp-consent{position:fixed;left:0;right:0;bottom:0;z-index:2000;background:#101B17;' +
    'border-top:1px solid #24302B;box-shadow:0 -6px 18px rgba(0,0,0,.35);color:#F2F3F1;' +
    "font:500 13px/1.45 'IBM Plex Sans',system-ui,sans-serif;padding:12px 14px calc(12px + env(safe-area-inset-bottom))}" +
    '#dp-consent[hidden]{display:none}' +
    '#dp-consent .dp-cb-in{max-width:1000px;margin:0 auto}' +
    '#dp-consent p{margin:0 0 10px}' +
    '#dp-consent a{color:#79D9B8}' +
    '#dp-consent .dp-cb-btns{display:flex;gap:10px}' +
    '#dp-consent button{flex:1 1 0;min-height:44px;border-radius:8px;border:1px solid #4FBF98;' +
    'background:#15241F;color:#F2F3F1;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer}' +
    '#dp-consent button:hover,#dp-consent button:focus-visible{background:#1C3029}' +
    'body.dp-cb-open{padding-bottom:var(--dp-cb-h,0px)}' +
    'body.dp-cb-open #sg-root{bottom:calc(var(--dp-cb-h,0px) + 10px)}' +
    '@media (min-width:720px){#dp-consent .dp-cb-in{display:flex;align-items:center;gap:18px}' +
    '#dp-consent p{margin:0;flex:1}#dp-consent .dp-cb-btns{flex:0 0 auto}#dp-consent button{min-width:120px}}';

  function syncHeight() {
    try {
      var h = banner && !banner.hidden ? banner.offsetHeight : 0;
      d.documentElement.style.setProperty('--dp-cb-h', h + 'px');
    } catch (e) {}
  }

  function buildBanner() {
    var st = d.createElement('style');
    st.textContent = CSS;
    (d.head || d.documentElement).appendChild(st);
    banner = d.createElement('div');
    banner.id = 'dp-consent';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Cookie choice');
    banner.hidden = true;
    banner.innerHTML =
      '<div class="dp-cb-in">' +
      '<p>We\u2019d like to use Google Analytics cookies to see which devices and pages people use, so we can improve the site. ' +
      'No ads, and we never send your email or name to Google. <a href="/privacy">Privacy policy</a></p>' +
      '<div class="dp-cb-btns">' +
      '<button type="button" data-dp-choice="granted">Accept</button>' +
      '<button type="button" data-dp-choice="denied">Decline</button>' +
      '</div></div>';
    banner.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest && ev.target.closest('[data-dp-choice]');
      if (!b) return;
      var v = b.getAttribute('data-dp-choice');
      setChoice(v);
      hideBanner();
      if (v === 'granted') loadGa(); else stopGa();
    });
    d.body.appendChild(banner);
    w.addEventListener('resize', syncHeight);
  }

  function showBanner(focus) {
    try {
      if (!banner) buildBanner();
      banner.hidden = false;
      d.body.classList.add('dp-cb-open');
      syncHeight();
      if (focus) { var b = banner.querySelector('button'); if (b) b.focus(); }
    } catch (e) {}
  }

  function hideBanner() {
    try {
      if (banner) banner.hidden = true;
      d.body.classList.remove('dp-cb-open');
      syncHeight();
    } catch (e) {}
  }

  // 4) Footer "Cookie settings" links.
  try {
    d.addEventListener('click', function (ev) {
      var a = ev.target && ev.target.closest && ev.target.closest('[data-dp-cookie-settings]');
      if (!a) return;
      ev.preventDefault();
      clearChoice();
      showBanner(true);
    });
  } catch (e) {}

  // 5) Start.
  function start() {
    var c = getChoice();
    if (c === 'granted') loadGa();
    else if (c !== 'denied') showBanner(false);
  }
  try {
    if (d.body) start();
    else d.addEventListener('DOMContentLoaded', start);
  } catch (e) {}
})();
