// Goliath Social: add friends by email, accept requests, and follow each other's finished workouts.
// Needs accounts (auth.js). Privacy is enforced by the database: nothing is visible until both people accept.
(function(){
  const AUTH = window.__goliathAuth;
  if (!AUTH) return;                                   // accounts are off: no Social tab
  let me = null, profile = null, friends = [], feed = [], profiles = {}, loading = false, loaded = false, err = '';
  let open = null, confirmRemove = null, sending = false, formMsg = null;
  const sb = () => AUTH.sb;
  const myEmail = () => (me && me.email || '').toLowerCase();
  const myName = () => ((me && me.user_metadata && me.user_metadata.name) || '').trim();

  // ---------- tab ----------
  const css = document.createElement('style');
  css.textContent = `
  .soc{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;padding-block:6px 80px;max-width:720px;margin:0 auto}
  .soc .panel,.soc .fr,.soc .req,.soc .wk{min-width:0}
  .soc h1{font-size:46px}
  .soc .add{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
  .soc .add .inrow{display:flex;gap:8px}
  .soc .add input{flex:1;min-width:0;border:1.5px solid var(--line);background:var(--surface);color:var(--ink);border-radius:10px;padding:12px;font:600 16px var(--f-body)}
  .soc .add .btn{width:auto;flex:none;padding:12px 16px;font-size:15px}
  .soc .msg{font-size:13.5px;padding:8px 10px;border-radius:8px}
  .soc .msg.ok{background:var(--green-soft);color:var(--green)} .soc .msg.err{background:var(--red-soft);color:var(--red)}
  .pp{display:flex;align-items:center;gap:12px;min-width:0}
  .pp .av{width:40px;height:40px;border-radius:50%;background:var(--ink);color:var(--bg);display:grid;place-items:center;font:700 16px var(--f-body);flex:none}
  .pp .av.me{background:var(--accent);color:var(--on-accent)}
  .pp b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pp small{display:block;color:var(--muted);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pp > span{min-width:0;flex:1}
  .req{display:grid;gap:10px}
  .req + .req{border-top:1px solid var(--line);padding-top:12px}
  .req .row{gap:8px} .req .row .chip{flex:none}
  .wk{display:grid;gap:10px;padding:14px 16px;background:var(--surface);border:1px solid var(--line);border-radius:16px}
  .wk .what{font-size:15px}
  .wk .what b{font-weight:700}
  .wk .hl{display:flex;flex-wrap:wrap;gap:6px}
  .wk .hl span{font:600 12.5px var(--f-mono);background:var(--surface-2);border-radius:6px;padding:4px 7px;font-variant-numeric:tabular-nums}
  .wk .meta{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:12.5px;color:var(--muted);align-items:center}
  .rate-chip{font:700 11px var(--f-mono);letter-spacing:.06em;text-transform:uppercase;padding:3px 7px;border-radius:5px;background:var(--accent-soft);color:var(--accent)}
  .fr{display:grid;gap:10px}
  .fr + .fr{border-top:1px solid var(--line);padding-top:12px}
  .fr .pp{cursor:pointer;background:none;border:0;padding:0;text-align:left;width:100%;color:inherit}
  .fr .wkdots{display:flex;gap:3px;flex:none}
  .fr .wkdots i{width:8px;height:8px;border-radius:2px;background:var(--line)}
  .fr .wkdots i.on{background:var(--green)}
  .switch{display:flex;align-items:center;justify-content:space-between;gap:12px}
  .switch span{font-size:14px;color:var(--muted)}
  .switch button{flex:none;width:52px;height:30px;border-radius:15px;border:0;background:var(--line);position:relative;padding:0}
  .switch button::after{content:"";position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:var(--surface);transition:left .15s}
  .switch button[aria-checked="true"]{background:var(--green)}
  .switch button[aria-checked="true"]::after{left:25px}
  .tab-dot{position:absolute;top:6px;right:calc(50% - 18px);min-width:16px;height:16px;border-radius:8px;background:var(--red);color:#fff;font:700 10px/16px var(--f-body);padding:0 4px}
  .tabbar button{position:relative}
  .soc .empty{text-align:left;padding:4px 0;color:var(--muted);font-size:14px}`;
  document.head.appendChild(css);
  const main = document.createElement('main'); main.id = 'tabSocial'; main.hidden = true;
  document.querySelector('.app').appendChild(main);
  const tb = document.createElement('button');
  tb.id = 'tbSocial'; tb.dataset.tab = 'social'; tb.hidden = true;
  tb.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.3A5 5 0 0 1 21 19"/></svg>Social`;
  document.querySelector('.tabbar .in').appendChild(tb);
  const _render = render;
  render = function(){
    _render();
    main.hidden = S.tab !== 'social'; tb.classList.toggle('on', S.tab === 'social');
    if (S.tab === 'social'){ document.getElementById('viewSeg').hidden = true; renderSocial(); if (!loading && me) load(); }
  };

  // ---------- data ----------
  async function ensureProfile(){
    const {data} = await sb().from('goliath_profiles').select('user_id, email, name, share').eq('user_id', me.id).maybeSingle();
    if (!data){
      const {data: d} = await sb().from('goliath_profiles').insert({user_id: me.id, email: myEmail(), name: myName()}).select().maybeSingle();
      profile = d || {share: true};
    } else {
      profile = data;
      if (data.name !== myName() || data.email !== myEmail()){ await sb().from('goliath_profiles').update({name: myName(), email: myEmail(), updated_at: new Date().toISOString()}).eq('user_id', me.id); profile.name = myName(); }
    }
  }
  async function claimRequests(){
    // requests sent to my email before (or since) I signed up become mine
    await sb().from('goliath_friends').update({addressee: me.id}).eq('addressee_email', myEmail()).is('addressee', null);
  }
  async function load(){
    if (!me || loading) return; loading = true; err = '';
    try {
      const [fr, wk] = await Promise.all([
        sb().from('goliath_friends').select('*').order('created_at', {ascending: false}),
        sb().from('goliath_workouts').select('*').gte('done_at', new Date(Date.now() - 28 * 864e5).toISOString()).order('done_at', {ascending: false}).limit(200)
      ]);
      if (fr.error || wk.error) throw (fr.error || wk.error);
      friends = fr.data || []; feed = wk.data || [];
      const ids = [...new Set(friends.filter(f => f.status === 'accepted').map(f => f.requester === me.id ? f.addressee : f.requester).filter(Boolean))];
      profiles = {};
      if (ids.length){ const {data} = await sb().from('goliath_profiles').select('user_id, name, email').in('user_id', ids); (data || []).forEach(p => profiles[p.user_id] = p); }
      loaded = true;
    } catch(e){ err = navigator.onLine ? 'Could not load Social just now. Pull down or reopen the tab to retry.' : 'You are offline. Social updates when you reconnect.'; }
    loading = false; paintBadge(); if (S.tab === 'social') renderSocial();
  }
  const incoming = () => friends.filter(f => f.status === 'pending' && f.addressee_email === myEmail());
  const outgoing = () => friends.filter(f => f.status === 'pending' && f.requester === me.id);
  const accepted = () => friends.filter(f => f.status === 'accepted');
  const otherOf = f => f.requester === me.id ? f.addressee : f.requester;
  function nameOf(uid){
    if (uid === me.id) return 'You';
    const p = profiles[uid]; const f = friends.find(x => otherOf(x) === uid);
    return (p && p.name) || (f && f.requester === uid && f.requester_name) || (p && p.email) || (f && (f.requester === uid ? f.requester_email : f.addressee_email)) || 'Friend';
  }
  const initialOf = uid => (uid === me.id ? (myName() || myEmail()) : nameOf(uid))[0].toUpperCase();
  function paintBadge(){
    const n = incoming().length; let d = tb.querySelector('.tab-dot');
    if (!n){ if (d) d.remove(); return; }
    if (!d){ d = document.createElement('span'); d.className = 'tab-dot'; tb.appendChild(d); }
    d.textContent = n; tb.setAttribute('aria-label', `Social, ${n} friend request${n > 1 ? 's' : ''}`);
  }

  // ---------- posting finished workouts ----------
  const _submit = submitReview;
  submitReview = function(){
    _submit.apply(this, arguments);
    const h = HIST[0]; if (!me || !h) return;
    const items = (h.items || []).filter(x => x.w != null && x.r != null && x.w >= 0 && x.r > 0);
    const best = items.sort((a, b) => b.w * (1 + b.r / 30) - a.w * (1 + a.r / 30)).slice(0, 3).map(x => ({n: x.n, w: x.w, r: x.r}));
    const sets = (h.items || []).reduce((t, x) => t + (+x.s || 0), 0);
    const plan = GP && GP.custom ? `${GP.name}${GP.weekInfo && GP.weekInfo !== 'Every week' && GP.weekInfo !== 'Single workout' ? ' · ' + GP.weekInfo.split(' · ').slice(0, 1)[0] : ''}` : 'Suggested plan';
    sb().from('goliath_workouts').insert({user_id: me.id, done_at: new Date(h.at).toISOString(), day_name: h.day || 'Workout', plan_name: plan, rating: h.rating || null, sets_done: sets, highlights: best, unit: GP ? GP.unit : 'lb'})
      .then(({error}) => { if (!error){ loaded && load(); } });
  };

  // ---------- screen ----------
  function ago(t){
    const s = (Date.now() - Date.parse(t)) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    const d = new Date(t), y = new Date(); y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric'});
  }
  const RATE_N = r => (RATE.find(x => x[0] === r) || [0, ''])[1];
  function wkCard(w){
    const who = w.user_id === me.id;
    return `<div class="wk">
      <div class="pp"><span class="av${who ? ' me' : ''}" aria-hidden="true">${esc(initialOf(w.user_id))}</span><span><b>${esc(nameOf(w.user_id))}</b><small>${esc(ago(w.done_at))}</small></span></div>
      <div class="what">Finished <b>${esc(w.day_name)}</b>${w.plan_name ? ` · ${esc(w.plan_name)}` : ''}</div>
      ${w.highlights && w.highlights.length ? `<div class="hl">${w.highlights.map(h => `<span>${esc(h.n)} ${esc(h.w)}${w.unit === 'kg' ? ' kg' : ''} × ${esc(h.r)}</span>`).join('')}</div>` : ''}
      <div class="meta">${w.rating ? `<span class="rate-chip">${w.rating}/5 · ${esc(RATE_N(w.rating))}</span>` : ''}${w.sets_done ? `<span>${w.sets_done} sets</span>` : ''}</div>
    </div>`;
  }
  function weekDots(uid){
    const since = Date.now() - 7 * 864e5, n = feed.filter(w => w.user_id === uid && Date.parse(w.done_at) > since).length;
    return {n, html: `<span class="wkdots" aria-label="${n} workout${n === 1 ? '' : 's'} in the last 7 days">${[0,1,2,3,4,5].map(i => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`};
  }
  function renderSocial(){
    if (!me){ main.innerHTML = ''; return; }
    const inc = incoming(), out = outgoing(), acc = accepted();
    const mine = weekDots(me.id);
    main.innerHTML = `<div class="soc">
      <div><div class="eyebrow">Social</div><h1 class="display">Your crew</h1>
      <p class="lede" style="margin-top:8px">Add friends by email and keep up with each other's workouts. They only see what you finish in the Gym tab, never your body stats, injuries or notes.</p></div>
      <form class="panel add" id="socAdd" novalidate>
        <label class="eyebrow" for="socEmail">Add a friend</label>
        <div class="inrow"><input id="socEmail" type="email" inputmode="email" autocomplete="off" placeholder="friend@email.com" aria-label="Friend's email"><button class="btn" type="submit" ${sending ? 'disabled' : ''}>${sending ? 'Sending…' : 'Send'}</button></div>
        ${formMsg ? `<div class="msg ${formMsg.k}" role="status">${esc(formMsg.t)}</div>` : '<span class="hint" style="text-align:left">They see your request next time they open Goliath. If they don\'t have an account yet, it waits for them.</span>'}
      </form>
      ${err ? `<div class="panel" role="alert" style="color:var(--red)">${esc(err)}</div>` : ''}
      ${inc.length ? `<div class="panel"><h3>Friend requests</h3>${inc.map(f => `<div class="req"><div class="pp"><span class="av" aria-hidden="true">${esc((f.requester_name || f.requester_email)[0].toUpperCase())}</span><span><b>${esc(f.requester_name || f.requester_email)}</b><small>${esc(f.requester_email)} wants to share workouts</small></span></div><div class="row"><button class="chip sm ink on" data-soc="accept" data-id="${f.id}">Accept</button><button class="chip sm" data-soc="decline" data-id="${f.id}">Decline</button></div></div>`).join('')}</div>` : ''}
      <div class="panel"><h3>This week</h3>
        <div class="fr"><div class="pp"><span class="av me" aria-hidden="true">${esc(initialOf(me.id))}</span><span><b>You</b><small>${mine.n} workout${mine.n === 1 ? '' : 's'} in the last 7 days</small></span>${mine.html}</div></div>
        ${acc.map(f => { const uid = otherOf(f); if (!uid) return ''; const d = weekDots(uid); const last = feed.find(w => w.user_id === uid); const isOpen = open === uid;
          return `<div class="fr"><button class="pp" data-soc="open" data-uid="${uid}" aria-expanded="${isOpen}"><span class="av" aria-hidden="true">${esc(initialOf(uid))}</span><span><b>${esc(nameOf(uid))}</b><small>${last ? `Last: ${esc(last.day_name)}, ${esc(ago(last.done_at))}` : 'No workouts shared yet'}</small></span>${d.html}</button>
          ${isOpen ? `${feed.filter(w => w.user_id === uid).slice(0, 5).map(wkCard).join('') || '<p class="empty">Nothing in the last 4 weeks.</p>'}<div class="row">${confirmRemove === f.id ? `<button class="chip sm" style="color:var(--red);flex:none" data-soc="remove" data-id="${f.id}">Remove ${esc(nameOf(uid))}</button><button class="chip sm" style="flex:none" data-soc="keep">Keep</button>` : `<button class="chip sm" style="flex:none" data-soc="askremove" data-id="${f.id}">Remove friend</button>`}</div>` : ''}</div>`; }).join('')}
        ${!acc.length ? `<p class="empty">${loaded ? 'No friends yet. Add someone by email above.' : 'Loading…'}</p>` : ''}
      </div>
      ${acc.length ? `<div><div class="eyebrow" style="margin:4px 0 10px">Recent workouts</div><div style="display:grid;gap:10px">${feed.slice(0, 25).map(wkCard).join('') || '<p class="empty">No workouts yet. Finish one in the Gym tab and it shows up here.</p>'}</div></div>` : ''}
      ${out.length ? `<div class="panel"><h3>Waiting for a reply</h3>${out.map(f => `<div class="req"><div class="pp"><span class="av" aria-hidden="true" style="background:var(--muted)">${esc(f.addressee_email[0].toUpperCase())}</span><span><b>${esc(f.addressee_email)}</b><small>Sent ${esc(ago(f.created_at))}</small></span><button class="chip sm" style="flex:none" data-soc="cancel" data-id="${f.id}">Cancel</button></div></div>`).join('')}</div>` : ''}
      <div class="panel switch"><div><b>Share my workouts</b><br><span>${profile && profile.share === false ? 'Friends can\'t see your workouts right now.' : 'Friends see each workout you finish.'}</span></div><button role="switch" aria-checked="${!(profile && profile.share === false)}" aria-label="Share my workouts with friends" data-soc="share"></button></div>
    </div>`;
  }
  main.addEventListener('submit', async e => {
    e.preventDefault();
    const el = main.querySelector('#socEmail'); const email = (el.value || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)){ formMsg = {k: 'err', t: 'Enter a valid email address.'}; return renderSocial(); }
    if (email === myEmail()){ formMsg = {k: 'err', t: 'That\'s your own email.'}; return renderSocial(); }
    if (friends.some(f => f.addressee_email === email || f.requester_email === email)){ formMsg = {k: 'err', t: 'You already have a request or friendship with that email.'}; return renderSocial(); }
    sending = true; renderSocial();
    const {error} = await sb().from('goliath_friends').insert({requester: me.id, requester_name: myName(), requester_email: myEmail(), addressee_email: email});
    sending = false;
    formMsg = error ? {k: 'err', t: /duplicate|unique/i.test(error.message) ? 'You already sent that person a request.' : 'Could not send the request. Try again.'} : {k: 'ok', t: `Request sent to ${email}.`};
    if (!error) await load(); else renderSocial();
  });
  main.addEventListener('input', e => { if (e.target.id === 'socEmail' && formMsg){ formMsg = null; const m = main.querySelector('.soc .msg'); if (m) m.remove(); } });
  main.addEventListener('click', async e => {
    const b = e.target.closest('[data-soc]'); if (!b) return;
    const a = b.dataset.soc, id = b.dataset.id;
    if (a === 'open'){ open = open === b.dataset.uid ? null : b.dataset.uid; confirmRemove = null; return renderSocial(); }
    if (a === 'askremove'){ confirmRemove = id; return renderSocial(); }
    if (a === 'keep'){ confirmRemove = null; return renderSocial(); }
    b.disabled = true;
    if (a === 'accept'){ const {error} = await sb().from('goliath_friends').update({status: 'accepted', addressee: me.id}).eq('id', id); toast(error ? 'Could not accept. Try again.' : 'You\'re now friends'); }
    if (a === 'decline' || a === 'cancel' || a === 'remove'){ const {error} = await sb().from('goliath_friends').delete().eq('id', id); confirmRemove = null; open = null; toast(error ? 'Could not update. Try again.' : a === 'remove' ? 'Friend removed' : a === 'cancel' ? 'Request cancelled' : 'Request declined'); }
    if (a === 'share'){ const next = !(profile && profile.share === false) ? false : true; const {error} = await sb().from('goliath_profiles').update({share: next}).eq('user_id', me.id); if (!error){ profile.share = next; toast(next ? 'Sharing your workouts' : 'Workouts hidden from friends'); } else toast('Could not change sharing. Try again.'); return renderSocial(); }
    formMsg = null; await load();
  });

  // ---------- lifecycle ----------
  window.addEventListener('goliath:signin', async e => {
    me = e.detail; tb.hidden = false;
    try { await ensureProfile(); await claimRequests(); } catch(err){}
    load();
  });
  window.addEventListener('goliath:signout', () => {
    me = null; profile = null; friends = []; feed = []; profiles = {}; loaded = false; open = null; formMsg = null;
    tb.hidden = true; paintBadge(); if (S.tab === 'social'){ S.tab = 'body'; render(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && me) load(); });
  if (AUTH.user){ me = AUTH.user; tb.hidden = false; ensureProfile().then(claimRequests).then(load).catch(load); }
})();
