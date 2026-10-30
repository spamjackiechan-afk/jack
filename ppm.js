// Price per mg comparison. Pure price tool: list price / listed mg of product.
// Data only from /data/catalog.json, /data/live_prices.json, /vendor_config.json.
(function(){
  'use strict';
  // Never listed on this page, whatever the data says.
  var BLOCKED = ['paradigm peptides','peptide sciences','amino asylum','swiss chems','prime peptides','pinnacle peptide labs'];
  var OFFLINE = 'Offline Peptides';
  var GLP_CATEGORY = 'Incretin & Metabolic-Pathway Compounds';
  var GLP_NAME = /glp|semaglutide|tirzepatide|retatrutide|cagrilintide|orforglipron|survodutide|mazdutide|liraglutide|dulaglutide|exenatide/i;
  var OFFLINE_DISCLOSURE = 'I earn a commission when you use my code. For laboratory research use only. Not for human consumption.';

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function isBlocked(v){ return BLOCKED.indexOf(String(v).trim().toLowerCase()) !== -1; }
  function isGlp(row){ return row.category === GLP_CATEGORY || GLP_NAME.test(row.peptide || ''); }

  // Only a plain single amount like "10mg" / "2.5 mg" counts. Blends, kits,
  // ranges, "x50 tabs", mcg/iu/mL and anything vague are skipped.
  function parseMg(row){
    var name = String(row.peptide || '');
    if (/combo|blend|stack|\(.*\/.*\)/i.test(name)) return null; // multi-compound listings
    var m = /^\s*(\d+(?:\.\d+)?)\s*mg\s*$/i.exec(String(row.size || ''));
    if (!m) return null;
    var mg = parseFloat(m[1]);
    if (!(mg > 0)) return null;
    if (typeof row.amount_mg === 'number' && Math.abs(row.amount_mg - mg) > 1e-9) return null; // disagreeing data: skip
    return mg;
  }

  // Same freshness contract as the homepage overlay (index.html applyLiveOverlay).
  function applyLive(rows, results){
    Object.keys(results || {}).forEach(function(vendor){
      var items = results[vendor] || {};
      var vals = Object.keys(items).map(function(k){ return items[k]; });
      var unreachable = vals.length > 0 && vals.every(function(r){ return r == null || r.price == null; });
      Object.keys(items).forEach(function(key){
        var r = items[key]; if (r == null) return;
        if (r.price == null && unreachable) return;
        var p = key.split(' | ');
        var row = rows.find(function(i){ return i.peptide === p[0] && i.format === p[1] && i.size === p[2]; });
        if (!row || !(vendor in row.prices)) return;
        if (r.price == null){ delete row.prices[vendor]; if (row.vendor_product_urls) delete row.vendor_product_urls[vendor]; return; }
        row.prices[vendor] = r.price;
        if (r.url && !(row.vendor_product_urls && row.vendor_product_urls[vendor])){ row.vendor_product_urls = row.vendor_product_urls || {}; row.vendor_product_urls[vendor] = r.url; }
      });
    });
  }

  function build(catalog, cfg, live){
    var rows = JSON.parse(JSON.stringify(catalog.included || []));
    if (live && live.results) applyLive(rows, live.results);
    var listings = [];
    rows.forEach(function(row){
      var mg = parseMg(row); if (mg == null) return;
      Object.keys(row.prices || {}).forEach(function(v){
        var price = row.prices[v], c = cfg[v] || {};
        if (typeof price !== 'number' || !(price > 0)) return;
        if (isBlocked(v) || c.hidden) return;
        if (String(c.currency || 'USD').toUpperCase() !== 'USD') return;
        if (v === OFFLINE && isGlp(row)) return; // Offline never alongside GLP-category products
        var url = (row.vendor_product_urls || {})[v] || null;
        if (url && !/^https:\/\//i.test(url)) url = null;
        listings.push({ product: row.peptide + (row.format && row.format !== 'Vial' ? ' (' + row.format + ')' : ''),
          vendor: v, size: row.size, mg: mg, price: price, ppm: price / mg, url: url });
      });
    });
    return listings;
  }

  function money(v, dp){ return '$' + v.toFixed(dp); }

  function init(listings, checkedAt){
    var selP = document.getElementById('ppmProduct'), selS = document.getElementById('ppmSize');
    var wrap = document.getElementById('ppmTableWrap'), empty = document.getElementById('ppmEmpty'), meta = document.getElementById('ppmMeta');
    var products = Array.from(new Set(listings.map(function(l){ return l.product; }))).sort(function(a,b){ return a.localeCompare(b); });
    selP.innerHTML = '<option value="">Choose a compound…</option>' + products.map(function(p){ return '<option>' + esc(p) + '</option>'; }).join('');
    var params = new URLSearchParams(location.search);
    if (params.get('p') && products.indexOf(params.get('p')) !== -1) selP.value = params.get('p');

    function fillSizes(){
      var mgs = Array.from(new Set(listings.filter(function(l){ return l.product === selP.value; }).map(function(l){ return l.mg; }))).sort(function(a,b){ return a-b; });
      selS.innerHTML = '<option value="">All sizes</option>' + mgs.map(function(m){ return '<option value="' + m + '">' + m + 'mg</option>'; }).join('');
    }
    function render(){
      var rows = listings.filter(function(l){ return l.product === selP.value && (!selS.value || l.mg === parseFloat(selS.value)); })
        .sort(function(a,b){ return a.ppm - b.ppm || a.price - b.price || a.vendor.localeCompare(b.vendor); });
      meta.textContent = (selP.value ? rows.length + ' listing' + (rows.length === 1 ? '' : 's') + '. ' : '') + (checkedAt ? 'Live prices last checked ' + new Date(checkedAt).toLocaleString() + '.' : '');
      if (!selP.value){ wrap.innerHTML = ''; empty.hidden = true; return; }
      if (!rows.length){ wrap.innerHTML = ''; empty.hidden = false; return; }
      empty.hidden = true;
      wrap.innerHTML = '<table class="ppm"><thead><tr><th>Vendor</th><th>Listing size</th><th>List price</th><th>Price per mg</th><th>Link</th></tr></thead><tbody>' +
        rows.map(function(l, i){
          var code = l.vendor === OFFLINE ? '<span class="code">Code DISCOUNTS10</span><span class="disc">' + esc(OFFLINE_DISCLOSURE) + '</span>' : '';
          return '<tr' + (i === 0 ? ' class="best"' : '') + '><td>' + esc(l.vendor) + code + '</td><td class="num">' + esc(l.mg) + 'mg</td><td class="num">' + money(l.price, 2) +
            '</td><td class="num ppmv">' + money(l.ppm, 2) + '/mg</td><td>' + (l.url ? '<a href="' + esc(l.url) + '" target="_blank" rel="noopener nofollow sponsored">View &#8599;</a>' : '—') + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    selP.addEventListener('change', function(){ fillSizes(); render(); });
    selS.addEventListener('change', render);
    fillSizes(); render();
  }

  function j(u){ return fetch(u, { cache: 'no-store' }).then(function(r){ if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }); }
  Promise.all([j('/data/catalog.json'), j('/vendor_config.json'), j('/data/live_prices.json').catch(function(){ return null; })])
    .then(function(d){ var l = build(d[0], d[1], d[2]); window.__PPM_LISTINGS = l; init(l, d[2] && d[2].checked_at); })
    .catch(function(e){ console.warn('price-per-mg load failed', e); document.getElementById('ppmMeta').textContent = 'Prices could not be loaded right now.'; });
})();
