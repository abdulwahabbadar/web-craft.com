// My Khata - login, sync, offline queue, WhatsApp share. script.js isi ke baad load hota hai.
(function () {
  const C = window.KHATA_CFG, ls = localStorage;
  const p = (new URLSearchParams(location.search).get('p') || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  const sfx = p ? '-' + p : '', KEY = 'khata-data' + sfx, K = n => 'kh_' + n + sfx;
  let sb = null, uid = null, email = '', timer = null, busy = false;
  const shareCache = {};
  const DOM = '@khata.app';
const toEmail = u => u.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '') + DOM;
  const T = (pr, ms) => Promise.race([pr, new Promise((_, j) => setTimeout(() => j(new Error('timeout')), ms || 8000))]);
  const read = () => { try { return JSON.parse(ls.getItem(KEY)); } catch (e) { return null; } };

  function boot() {
    const s = document.createElement('script'); s.src = 'script.js'; document.body.appendChild(s);
  }
  function uniq(a, b, k) { const m = new Map(); (b || []).concat(a || []).forEach(x => m.set(k(x), x)); return [...m.values()]; }
  const key = x => (x && x.id != null) ? 'i' + x.id : JSON.stringify(x);
  function merge(L, S) { // conflict: dono taraf ka data jod do (delete wapas aa sakta hai)
    const o = Object.assign({}, S, L);
    ['inventory', 'capitalEntries', 'expenses', 'stockPurchases'].forEach(f => o[f] = uniq(L[f], S[f], key));
    const cm = new Map((S.customers || []).map(c => [c.id, c]));
    (L.customers || []).forEach(c => { const s = cm.get(c.id); cm.set(c.id, s ? Object.assign({}, s, c, { entries: uniq(c.entries, s.entries, e => JSON.stringify(e)) }) : c); });
    o.customers = [...cm.values()];
    return o;
  }

  // ---------- login screen ----------
  function gate() {
    return new Promise(res => {
      let mode = 'in';
      const inp = 'width:100%;padding:12px;margin-bottom:10px;border:1px solid rgba(184,134,62,.35);border-radius:10px;font:inherit;font-size:15px;box-sizing:border-box';
      const btn = 'width:100%;border:0;border-radius:10px;padding:12px;font:inherit;font-weight:800;font-size:14px;cursor:pointer;margin-top:6px;';
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#F3E9D6;display:flex;align-items:center;justify-content:center;padding:16px;font-family:Inter,sans-serif;overflow:auto';
      d.innerHTML = `<div style="max-width:380px;width:100%;background:#fff8ea;border:1px solid rgba(184,134,62,.35);border-radius:18px;padding:22px;box-shadow:0 2px 8px rgba(43,27,18,.15);color:#2B1B12">
<h1 style="margin:0 0 4px;color:#8B2635;font-size:22px">📒 My Khata</h1>
<div id="g-sub" style="font-size:12px;color:#5B4636;margin-bottom:14px"></div>
<input id="g-e" type="text" placeholder="Username" autocomplete="username" autocapitalize="none" style="${inp}">
<input id="g-p" type="password" placeholder="Password (kam az kam 6 characters)" autocomplete="current-password" style="${inp}">
<div id="g-m" style="color:#8B2635;font-size:12px;font-weight:700;min-height:18px"></div>
<button id="g-go" style="${btn}background:#8B2635;color:#fff"></button>
<button id="g-sw" style="${btn}background:transparent;color:#5B4636;border:1px solid rgba(184,134,62,.35)"></button>
      document.body.appendChild(d);
      const $ = id => d.querySelector('#' + id), msg = (t, ok) => { $('g-m').style.color = ok ? '#3F6F52' : '#8B2635'; $('g-m').textContent = t; };
      function paint() {
        $('g-sub').textContent = mode === 'in' ? 'Apne account mein login karein' : 'Naya free account banayein';
        $('g-go').textContent = mode === 'in' ? 'Login' : 'Account Banayein';
        $('g-sw').textContent = mode === 'in' ? 'Naya account banayein' : 'Pehle se account hai? Login';
      }
      paint();
      $('g-sw').onclick = () => { mode = mode === 'in' ? 'up' : 'in'; msg(''); paint(); };
      $('g-go').onclick = async () => {
  const u = $('g-e').value.trim().toLowerCase(), pw = $('g-p').value;
  if (!/^[a-z0-9._-]{3,20}$/.test(u)) return msg('Username 3-20 characters: a-z, 0-9, . _ -');
  if (pw.length < 6) return msg('Password kam az kam 6 characters ka ho');
  const e = toEmail(u);
  $('g-go').disabled = true; msg('Ruk jayein...', true);
  const r = mode === 'in' ? await sb.auth.signInWithPassword({ email: e, password: pw }) : await sb.auth.signUp({ email: e, password: pw });
  $('g-go').disabled = false;
  if (r.error) return msg(/already|registered/i.test(r.error.message) ? 'Ye username pehle se maujood hai' : /invalid login/i.test(r.error.message) ? 'Username ya password ghalat hai' : r.error.message);
  if (!r.data.session) return msg('Supabase mein "Confirm email" OFF karein.');
  d.remove(); res(r.data.session);
};
});
  }

  // ---------- pull: server se data lana ----------
  async function pull() {
    const [dr, pr] = await T(Promise.all([
      sb.from('khata_data').select('data,version').eq('user_id', uid).maybeSingle(),
      sb.from('profiles').select('plan,plan_expires_at').eq('id', uid).maybeSingle()
    ]));
    if (dr.error) throw dr.error;
    const owner = ls.getItem(K('owner'));
    if (owner && owner !== uid) { [KEY, K('ver'), K('dirty')].forEach(k => ls.removeItem(k)); }
    let local = read(), dirty = !!ls.getItem(K('dirty')), data = local;
    if (dr.data) {
      const S = dr.data.data;
      if (local && (dirty || !owner)) { data = merge(local, S); ls.setItem(K('dirty'), Date.now()); }
      else data = S;
      ls.setItem(K('ver'), dr.data.version);
    } else if (local) ls.setItem(K('dirty'), Date.now());
    if (data) {
      if (!pr.error && pr.data) {
        const ex = pr.data.plan_expires_at ? new Date(pr.data.plan_expires_at).getTime() : 0;
        data.subscription = ex > Date.now() ? { plan: pr.data.plan, activatedAt: ex, expiresAt: ex } : { plan: null, activatedAt: null, expiresAt: null };
      }
      ls.setItem(KEY, JSON.stringify(data));
    }
    ls.setItem(K('owner'), uid);
  }

  // ---------- push: server par bhejna (offline ho to dirty rehta hai) ----------
  function snap(c, d) {
    const e = (c.entries || []).map(x => x.type === 'item' ? { t: x.time, k: 'i', n: x.item, q: x.qty, r: x.rate, a: x.total } : { t: x.time, k: 'p', a: x.amount });
    const bal = e.reduce((s, x) => s + (x.k === 'i' ? x.a : -x.a), 0);
    const item = { token: c.shareToken, name: c.name, shop: (d.shop && (d.shop.shopName || d.shop.ownerName)) || '', balance: bal, entries: e };
    return { token: c.shareToken, item, hash: JSON.stringify(item) };
  }
  async function flush() {
    if (busy || !sb || !uid || !navigator.onLine || !ls.getItem(K('dirty'))) return;
    busy = true;
    try {
      const mark = ls.getItem(K('dirty')), d = read(); if (!d) return;
      const out = Object.assign({}, d); delete out.subscription;
      const r = await T(sb.rpc('push_data', { p_data: out, p_base: +ls.getItem(K('ver')) || 0, p_shop: (d.shop && d.shop.shopName) || '' }), 20000);
      if (r.error) throw r.error;
      if (!r.data.ok) { // doosri device ne bhi change kiya tha: merge karke reload
        const m = merge(d, r.data.data); m.subscription = d.subscription;
        ls.setItem(KEY, JSON.stringify(m)); ls.setItem(K('ver'), r.data.version); ls.setItem(K('dirty'), Date.now());
        location.reload(); return;
      }
      ls.setItem(K('ver'), r.data.version);
      if (ls.getItem(K('dirty')) === mark) ls.removeItem(K('dirty'));
      const sh = (d.customers || []).filter(c => c.shareToken).map(c => snap(c, d)).filter(s => shareCache[s.token] !== s.hash);
      if (sh.length) { const r2 = await sb.rpc('sync_shares', { p_items: sh.map(s => s.item) }); if (!r2.error) sh.forEach(s => shareCache[s.token] = s.hash); }
    } catch (e) { /* offline ya server error: dirty rehta hai, dobara koshish hogi */ }
    busy = false;
  }
  async function resync() {
    if (!sb || !uid || !navigator.onLine) return;
    if (ls.getItem(K('dirty'))) return flush();
    try {
      const r = await sb.from('khata_data').select('version').eq('user_id', uid).maybeSingle();
      if (r.data && r.data.version > (+ls.getItem(K('ver')) || 0)) location.reload();
    } catch (e) {}
  }

  // ---------- public helpers ----------
  const api = {
    email: '',
    push() { ls.setItem(K('dirty'), Date.now()); clearTimeout(timer); timer = setTimeout(flush, 1500); },
    token() { const a = new Uint8Array(18); crypto.getRandomValues(a); return [...a].map(b => b.toString(16).padStart(2, '0')).join(''); },
    wa(c, bal, shop) {
      let ph = (c.phone || '').replace(/\D/g, '');
      if (ph.startsWith('0')) ph = '92' + ph.slice(1);
      const link = new URL('customer.html', location.href).href + '#' + c.shareToken;
      const txt = `Assalam o Alaikum ${c.name},\n${shop} ka hisab:\nBaqaya balance: Rs ${Math.round(bal).toLocaleString('en-US')}\nPura khata yahan dekhein: ${link}`;
      window.open('https://wa.me/' + ph + '?text=' + encodeURIComponent(txt), '_blank');
    }
  };
  window.__ks = api;

  async function signOut() {
    await flush();
    if (ls.getItem(K('dirty')) && !confirm('Kuch changes abhi online save nahi hue. Phir bhi logout karein? (wo changes ja sakti hain)')) return;
    await sb.auth.signOut();
    [KEY, K('ver'), K('dirty'), K('owner')].forEach(k => ls.removeItem(k));
    location.reload();
  }
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#cloud-out-btn')) signOut(); });
  window.addEventListener('online', resync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resync(); });
  setInterval(() => { if (!document.hidden) resync(); }, 60000);

  // ---------- start ----------
  async function start() {
    const offlineOK = !!ls.getItem(K('owner'));
    if (!window.supabase || !C || C.URL.includes('YOUR-')) {
      if (offlineOK) return boot();
      document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">Pehli dafa internet chahiye. config.js mein Supabase URL/KEY daalein.</p>'; return;
    }
    sb = window.supabase.createClient(C.URL, C.KEY, { auth: { storageKey: 'sb-khata' + sfx, persistSession: true, autoRefreshToken: true } });
    let session = null;
    try { session = (await T(sb.auth.getSession(), 4000)).data.session; } catch (e) {}
    if (!session) {
      if (offlineOK && !navigator.onLine) return boot();
      session = await gate();
    }
    uid = session.user.id; email = session.user.email; api.email = email.replace(DOM, '');
    try { await pull(); } catch (e) { /* offline: local data se chalao */ }
    boot(); flush();
  }
  start();
})();
