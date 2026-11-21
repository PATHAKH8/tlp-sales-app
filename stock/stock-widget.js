/*!
 * TL Pathak Stock Live — dashboard connector
 * Drop into the TL Pathak dashboard (LINK RICH SYNC), Command Centre or Quote Maker.
 *
 *   <div id="tlp-stock"></div>
 *   <script src="stock-widget.js"></script>      (or paste this whole file inside a <script> tag)
 *   <script>
 *     TLPStock.config({ api:'https://script.google.com/macros/s/XXXX/exec',
 *                       appUrl:'https://pathakh8.github.io/tlp-sales-app/stock/' });
 *     // Uses the same email + password as the stock app (sign-in is remembered on this browser).
 *     // If nobody is signed in, the card shows a small sign-in form.
 *     TLPStock.mount('#tlp-stock');          // live summary card: totals, per location, search
 *     // or TLPStock.embed('#tlp-stock');    // the full stock app inside a dashboard tab
 *   </script>
 *
 * Buy prices (ADMIN accounts only):
 *   await TLPStock.login('pathakh@gmail.com', password);   // once per browser, or sign in on the card
 *   const rows = await TLPStock.buyPrices();
 *   // -> [{ group:'All-Geared Lathe · 6 ft', last:185000, lastLanded:187415, avg, min, supplier, date, buys }]
 *   const p = await TLPStock.buyPrice('6 ft lathe');   // best match for one product
 *
 * For product rows / quotes:
 *   const a = await TLPStock.availability('6 ft lathe');
 *   // → { total:4, free:3, text:'Howrah HQ Showroom 3 · Bengaluru Showroom 1', groups:[...] }
 */
(function (w) {
  const C = { api: '', appUrl: '', poll: 20000 };
  const ls = { get: k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  let session = ls.get('tlp_sess'), mounted = [];
  let cache = null, ver = '', timers = [];
  const fix = u => { const m = String(u).match(/drive\.google\.com\/(?:thumbnail\?id=|uc\?[^#]*?id=|file\/d\/)([\w-]{20,})/); return m ? 'https://lh3.googleusercontent.com/d/' + m[1] + '=w300' : u; };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function get(params) {
    if (!C.api) throw new Error('TLPStock: call config({api}) first');
    const u = C.api + (C.api.includes('?') ? '&' : '?') + new URLSearchParams({ session: session, ...params });
    const r = await fetch(u, { redirect: 'follow' });
    const j = await r.json();
    if (!j.ok) { const e = new Error(j.error === 'SIGNED_OUT' ? 'Please sign in' : j.error === 'CHANGE_PASSWORD' ? 'Open the stock app once to set your password' : (j.error || 'Stock server error')); e.code = j.error; throw e; }
    return j;
  }
  async function login(email, password) {
    const r = await fetch(C.api, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'login', email: email, password: password }) });
    const j = await r.json(); if (!j.ok) throw new Error(j.error || 'Sign-in failed');
    session = j.session; ls.set('tlp_sess', session); ls.set('tlp_user', JSON.stringify(j.user)); cache = null;
    mounted.forEach(f => f()); return j.user;
  }
  function logout() { session = ''; ls.set('tlp_sess', ''); cache = null; mounted.forEach(f => f()); }
  async function summary(q, location) {
    if (!q && !location && cache) {
      try { const v = await get({ action: 'ver' }); if (v.ver === ver) return cache; } catch (e) { return cache; }
    }
    const j = await get({ action: 'summary', q: q || '', location: location || '' });
    if (!q && !location) { cache = j.data; ver = j.data.ver; }
    return j.data;
  }
  async function availability(query) {
    const d = await summary(query);
    const per = {};
    d.groups.forEach(g => Object.entries(g.byLocation).forEach(([l, n]) => per[l] = (per[l] || 0) + n));
    return { total: d.total, free: d.free, groups: d.groups,
      text: Object.entries(per).sort((a, b) => b[1] - a[1]).map(([l, n]) => l + ' ' + n).join(' \u00B7 ') || 'Not in stock' };
  }
  async function buyPrices() { const j = await get({ action: 'buyPrices' }); return j.data; }
  async function buyPrice(query) {
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    const rows = await buyPrices();
    return rows.find(r => words.every(w => r.group.toLowerCase().indexOf(w) >= 0)) || null;
  }
  function appLink(q) { return C.appUrl ? C.appUrl + (q ? (C.appUrl.includes('?') ? '&' : '?') + 'q=' + encodeURIComponent(q) : '') + '#stock' : '#'; }

  const CSS = `.tlps{font-family:Barlow,system-ui,sans-serif;color:#15181D;background:#fff;border:1px solid #E1E3DD;border-radius:14px;padding:14px;max-width:100%}
  .tlps *{box-sizing:border-box}.tlps-h{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px}
  .tlps-t{font:700 17px "Barlow Condensed",sans-serif;letter-spacing:.06em;color:#0D2F6E;display:flex;align-items:center;gap:7px}
  .tlps-dot{width:8px;height:8px;border-radius:50%;background:#3DDC84;box-shadow:0 0 0 3px rgba(61,220,132,.25)}
  .tlps-open{background:#D7262E;color:#fff;border-radius:9px;padding:7px 12px;font-weight:700;font-size:13.5px;text-decoration:none;white-space:nowrap}
  .tlps-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}
  .tlps-s{background:#F2F3EF;border-radius:10px;padding:9px 10px}.tlps-s b{display:block;font:700 22px "JetBrains Mono",monospace}.tlps-s span{font-size:12px;color:#4A515C}
  .tlps-s.hi{background:#1446A0;color:#fff}.tlps-s.hi span{color:#cfdcf5}
  .tlps-loc{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}.tlps-loc span{background:#E7EEFA;color:#1446A0;border-radius:999px;padding:4px 10px;font-size:12.5px;font-weight:600}
  .tlps-in{width:100%;border:1px solid #E1E3DD;border-radius:10px;padding:9px 12px;font:inherit;font-size:15px;margin-bottom:8px;outline:0}
  .tlps-in:focus{border-color:#1446A0}
  .tlps-list{max-height:360px;overflow:auto}.tlps-g{display:flex;gap:10px;align-items:center;padding:8px 2px;border-top:1px solid #EEF0EA;text-decoration:none;color:inherit}
  .tlps-g i{width:38px;height:38px;border-radius:8px;background:#EEF0EA center/cover;flex:none}
  .tlps-g div{flex:1;min-width:0}.tlps-g b{display:block;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tlps-g small{display:block;font-size:12px;color:#4A515C;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tlps-g em{font:700 16px "JetBrains Mono",monospace;font-style:normal;color:#1446A0;text-align:right}
  .tlps-g em small{font:500 10.5px Barlow,sans-serif;color:#8A919C}.tlps-e{color:#4A515C;font-size:14px;padding:10px 0;text-align:center}`;
  function style() { if (document.getElementById('tlps-css')) return; const s = document.createElement('style'); s.id = 'tlps-css'; s.textContent = CSS; document.head.appendChild(s); }

  function mount(sel, opts) {
    style();
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!el) return;
    const o = Object.assign({ location: '' }, opts);
    el.innerHTML = `<div class="tlps"><div class="tlps-h"><div class="tlps-t"><span class="tlps-dot"></span>LIVE STOCK</div><a class="tlps-open" target="_blank" rel="noopener" href="${esc(appLink())}">Open stock app &rarr;</a></div>
      <div class="tlps-stats"></div><div class="tlps-loc"></div><input class="tlps-in" placeholder="Search: lathe 6 ft, pallet truck..."><div class="tlps-list"><div class="tlps-e">Loading...</div></div></div>`;
    const $ = s => el.querySelector(s); let qv = '', tq;
    async function draw() {
      try {
        const d = await summary(qv, o.location);
        $('.tlps-stats').innerHTML = `<div class="tlps-s hi"><b>${d.total}</b><span>In stock</span></div><div class="tlps-s"><b>${d.free}</b><span>Free to sell</span></div><div class="tlps-s"><b>${d.groups.length}</b><span>Groups</span></div>`;
        $('.tlps-loc').innerHTML = Object.entries(d.byLocation).sort((a, b) => b[1] - a[1]).map(([l, n]) => `<span>${esc(l.replace(/\s*(Showroom|Warehouse)\s*/i, ' ').trim())} ${n}</span>`).join('');
        $('.tlps-list').innerHTML = d.groups.length ? d.groups.map(g => `<a class="tlps-g" target="_blank" rel="noopener" href="${esc(appLink(g.group))}"><i style="${/^https:\/\//.test(g.photo) ? `background-image:url('${esc(fix(g.photo))}')` : ''}"></i><div><b>${esc(g.group)}</b><small>${Object.entries(g.byLocation).map(([l, n]) => esc(l.replace(/\s*(Showroom|Warehouse)\s*/i, ' ').trim()) + ' ' + n).join(' \u00B7 ')}${g.reserved ? ' \u00B7 ' + g.reserved + ' reserved' : ''}</small></div><em>${g.total}<small><br>${g.free} free</small></em></a>`).join('') : `<div class="tlps-e">${qv ? 'Not in stock anywhere' : 'No stock recorded yet'}</div>`;
      } catch (e) {
        if (e.code === 'SIGNED_OUT') {
          $('.tlps-list').innerHTML = `<form class="tlps-login"><input class="tlps-in" type="email" placeholder="Email" autocomplete="username"><input class="tlps-in" type="password" placeholder="Password" autocomplete="current-password"><button class="tlps-open" style="border:0;width:100%;padding:10px" type="submit">Sign in to see live stock</button><div class="tlps-e" style="color:#D7262E"></div></form>`;
          const f = $('.tlps-login'); f.onsubmit = async ev => { ev.preventDefault(); const i = f.querySelectorAll('input'); try { await login(i[0].value.trim(), i[1].value); } catch (er) { f.querySelector('.tlps-e').textContent = er.message; } };
        } else $('.tlps-list').innerHTML = `<div class="tlps-e">Cannot reach stock: ${esc(e.message)}</div>`;
      }
    }
    mounted.push(draw);
    $('.tlps-in').addEventListener('input', e => { qv = e.target.value.trim(); clearTimeout(tq); tq = setTimeout(draw, 350); });
    draw();
    timers.push(setInterval(() => { if (document.visibilityState === 'visible' && !qv) draw(); }, C.poll));
  }
  function embed(sel, opts) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!el || !C.appUrl) return;
    const h = (opts && opts.height) || '85vh';
    const p = new URLSearchParams({ embed: '1', api: C.api });
    if (opts && opts.location) p.set('loc', opts.location);
    el.innerHTML = `<iframe src="${esc(C.appUrl + (C.appUrl.includes('?') ? '&' : '?') + p)}" style="width:100%;height:${esc(h)};border:0;border-radius:14px;background:#F2F3EF" allow="camera" title="TL Pathak Stock Live"></iframe>`;
  }
  w.TLPStock = { config: o => Object.assign(C, o), login, logout, mount, embed, summary, availability, buyPrices, buyPrice, appLink };
})(window);
