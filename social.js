// Goliath Social: add friends by email, follow each other's workouts, see who's online, and message each other.
// Needs accounts (auth.js). Privacy is enforced by the database: nothing is visible until both people accept.
(function(){
  const AUTH = window.__goliathAuth;
  if (!AUTH) return;                                   // accounts are off: no Social tab
  let me = null, profile = null, friends = [], feed = [], profiles = {}, loading = false, loaded = false, err = '';
  let open = null, confirmRemove = null, sending = false, formMsg = null, addOpen = false, addTouched = false, setOpen = false;
  let shares = [], send = null;   // send = {prog, friend, note, busy} while the send-a-program panel is open
  let msgs = [], chat = null, rt = null, rtOk = false, lastSetAt = 0, lastBeat = 0, cheered = new Set();
  const ONLINE_MS = 150000;        // a heartbeat newer than 2.5 min counts as online
  const sb = () => AUTH.sb;
  const myEmail = () => (me && me.email || '').toLowerCase();
  const myName = () => ((me && me.user_metadata && me.user_metadata.name) || '').trim();

  // ---------- tab ----------
  const css = document.createElement('style');
  css.textContent = `
  .soc{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;padding-block:6px 80px;max-width:720px;margin:0 auto}
  .soc .panel,.soc .fr,.soc .req,.soc .wk{min-width:0}
  .soc h1{font-size:46px}
  .soc-head h1{white-space:nowrap;font-size:clamp(30px,9.6vw,46px)}
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
  .pg-pick{display:grid;gap:8px}
  .pg-opt{display:flex;align-items:center;gap:10px;text-align:left;width:100%;border:1.5px solid var(--line);background:var(--surface);color:var(--ink);border-radius:12px;padding:10px 12px;min-width:0}
  .pg-opt[aria-pressed="true"]{border-color:var(--accent);background:var(--accent-soft)}
  .pg-opt > span{min-width:0;flex:1}
  .pg-opt b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}
  .pg-opt small{display:block;color:var(--muted);font-size:12.5px}
  .pg-opt .av{width:32px;height:32px;border-radius:50%;background:var(--ink);color:var(--bg);display:grid;place-items:center;font:700 13px var(--f-body);flex:none}
  .pg-opt,.pg-opt *{text-align:left}
  .soc .send .row .btn{width:auto}
  .soc .send textarea{width:100%;min-height:60px;border:1.5px solid var(--line);background:var(--surface);color:var(--ink);border-radius:10px;padding:10px;font:500 15px var(--f-body);resize:vertical}
  .shr{display:grid;gap:10px}
  .shr + .shr{border-top:1px solid var(--line);padding-top:12px}
  .shr q{font-size:14px;color:var(--muted);font-style:italic}
  .soc-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}
  .soc-head > div{min-width:0}
  .soc-acts{display:flex;gap:8px;flex:none;padding-bottom:6px}
  .icobtn{width:44px;height:44px;border-radius:50%;border:1.5px solid var(--line);background:var(--surface);color:var(--ink);display:grid;place-items:center;padding:0}
  .icobtn svg{width:22px;height:22px}
  .icobtn[aria-expanded="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
  .icobtn.add{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
  .icobtn.add[aria-expanded="true"]{background:var(--ink);border-color:var(--ink)}
  .soc .sets{display:grid;gap:14px}
  .soc .sets .switch + .switch{border-top:1px solid var(--line);padding-top:14px}
  .soc .empty{text-align:left;padding:4px 0;color:var(--muted);font-size:14px}
  .avw{position:relative;flex:none;display:grid}
  .pp > .avw{flex:none;min-width:auto}
  .avw .av{width:40px;height:40px;border-radius:50%;background:var(--ink);color:var(--bg);display:grid;place-items:center;font:700 16px var(--f-body)}
  .avw .av.me{background:var(--accent);color:var(--on-accent)}
  .avw .on-dot{position:absolute;right:-1px;bottom:-1px;width:13px;height:13px;border-radius:50%;background:var(--green);border:2.5px solid var(--surface)}
  .pp small.live{color:var(--green);font-weight:600}
  .pp small.new{color:var(--ink);font-weight:600}
  .frrow{display:flex;align-items:center;gap:8px;min-width:0}
  .frrow > .pp{flex:1}
  .msgbtn{flex:none;position:relative;width:42px;height:42px;border-radius:50%;border:1.5px solid var(--line);background:var(--surface);color:var(--ink);display:grid;place-items:center;padding:0}
  .msgbtn svg{width:20px;height:20px}
  .msgbtn .tab-dot{top:-4px;right:-4px}
  .online-strip{display:flex;gap:14px;overflow-x:auto;padding:2px 2px 4px;scrollbar-width:none}
  .online-strip button{flex:none;display:grid;justify-items:center;gap:5px;background:none;border:0;padding:0;color:var(--ink);width:58px}
  .online-strip .av{width:48px;height:48px;font-size:18px}
  .online-strip small{font-size:11.5px;max-width:58px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cheer{border:1.5px solid var(--line);background:var(--surface);border-radius:999px;padding:5px 11px;font:600 13px var(--f-body);color:var(--ink)}
  .cheer[disabled]{opacity:.6}
  .chat{gap:0;padding-bottom:0;min-height:calc(100dvh - 170px)}
  .chat-head{display:flex;align-items:center;gap:10px;padding:4px 0 12px;border-bottom:1px solid var(--line);position:sticky;top:var(--hdr,64px);background:var(--bg);z-index:3}
  .chat-head .chip{flex:none}
  .chat-list{display:flex;flex-direction:column;gap:4px;padding:14px 0;flex:1}
  .chat-day{align-self:center;font:600 11.5px var(--f-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:10px 0 6px}
  .bub{max-width:80%;padding:9px 13px;border-radius:18px;font-size:15.5px;line-height:1.4;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--surface);border:1px solid var(--line);color:var(--ink);align-self:flex-start;border-bottom-left-radius:6px}
  .bub.mine{align-self:flex-end;background:var(--accent);border-color:var(--accent);color:var(--on-accent);border-bottom-left-radius:18px;border-bottom-right-radius:6px}
  .bub.pending{opacity:.6}
  .bub-t{font-size:11px;color:var(--muted);margin:0 6px 6px}
  .bub-t.mine{align-self:flex-end}
  .chat-empty{margin:auto 0;text-align:center;color:var(--muted);font-size:14.5px;padding:30px 10px}
  .quick{display:flex;gap:6px;flex-wrap:wrap;padding-bottom:8px}
  .chat-comp{position:sticky;bottom:calc(var(--tbh,72px) + 6px);display:flex;gap:8px;align-items:flex-end;background:var(--bg);padding:8px 0 10px;border-top:1px solid var(--line)}
  .chat-comp textarea{flex:1;min-width:0;resize:none;max-height:120px;border:1.5px solid var(--line);background:var(--surface);color:var(--ink);border-radius:20px;padding:10px 14px;font:500 16px/1.35 var(--f-body)}
  .chat-comp .btn{width:auto;flex:none;border-radius:20px;padding:10px 16px;font-size:15px}`;
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
    else { chat = null; formMsg = null; addOpen = false; setOpen = false; }
  };

  // ---------- data ----------
  async function ensureProfile(){
    const {data} = await sb().from('goliath_profiles').select('user_id, email, name, share, presence').eq('user_id', me.id).maybeSingle();
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
      const [fr, wk, sh, ms] = await Promise.all([
        sb().from('goliath_friends').select('*').order('created_at', {ascending: false}),
        sb().from('goliath_workouts').select('*').gte('done_at', new Date(Date.now() - 28 * 864e5).toISOString()).order('done_at', {ascending: false}).limit(200),
        sb().from('goliath_program_shares').select('*').eq('recipient', me.id).order('created_at', {ascending: false}).limit(30),
        sb().from('goliath_messages').select('*').gte('created_at', new Date(Date.now() - 90 * 864e5).toISOString()).order('created_at', {ascending: false}).limit(1000)
      ]);
      if (fr.error || wk.error) throw (fr.error || wk.error);
      shares = sh.error ? [] : (sh.data || []);
      if (!ms.error){ const pend = msgs.filter(m => m.pending); msgs = (ms.data || []).reverse().concat(pend); }
      friends = fr.data || []; feed = wk.data || [];
      const ids = [...new Set(friends.filter(f => f.status === 'accepted').map(f => f.requester === me.id ? f.addressee : f.requester).filter(Boolean))];
      profiles = {};
      if (ids.length){ const {data} = await sb().from('goliath_profiles').select('user_id, name, email, last_seen, activity').in('user_id', ids); (data || []).forEach(p => profiles[p.user_id] = p); }
      loaded = true;
    } catch(e){ err = navigator.onLine ? 'Could not load Social just now. Pull down or reopen the tab to retry.' : 'You are offline. Social updates when you reconnect.'; }
    loading = false; paintBadge(); if (S.tab === 'social') renderSocial();
    if (chat) markRead(chat);
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
    const n = incoming().length + shares.length + unreadAll(); let d = tb.querySelector('.tab-dot');
    if (!n){ if (d) d.remove(); return; }
    if (!d){ d = document.createElement('span'); d.className = 'tab-dot'; tb.appendChild(d); }
    d.textContent = n; tb.setAttribute('aria-label', `Social, ${n} new`);
  }

  // ---------- online status ----------
  function presenceOf(uid){
    const p = profiles[uid]; if (!p || !p.last_seen) return {on: false, txt: ''};
    const age = Date.now() - Date.parse(p.last_seen), on = age < ONLINE_MS && p.activity !== 'off';
    if (on) return {on: true, txt: p.activity || 'Online'};
    return {on: false, txt: age < 14 * 864e5 ? 'Active ' + ago(p.last_seen).replace(/^Yesterday/, 'yesterday') : ''};
  }
  const avHTML = (uid, cls) => `<span class="avw"><span class="av${cls ? ' ' + cls : ''}" aria-hidden="true">${esc(initialOf(uid))}</span>${uid !== me.id && presenceOf(uid).on ? '<i class="on-dot" aria-hidden="true"></i>' : ''}</span>`;
  function myActivity(){
    if (document.visibilityState !== 'visible') return 'off';
    const di = S.gymDay;
    if (lastSetAt && Date.now() - lastSetAt < 30 * 60000 && typeof GP !== 'undefined' && GP && GP.days_ && GP.days_[di]) return ('Working out · ' + GP.days_[di].name).slice(0, 80);
    return '';
  }
  async function beat(){
    if (!me || !profile || profile.presence === false) return;
    lastBeat = Date.now();
    try { await sb().from('goliath_profiles').update({last_seen: new Date().toISOString(), activity: myActivity()}).eq('user_id', me.id); } catch(e){}
  }
  // ticking off a set marks you as working out (at most one update every 20 s)
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-set]')){ const was = myActivity(); lastSetAt = Date.now(); if (me && (Date.now() - lastBeat > 20000 || was !== myActivity())) beat(); } }, true);
  setInterval(() => { if (me && document.visibilityState === 'visible') beat(); }, 60000);
  setInterval(() => { if (me && document.visibilityState === 'visible' && S.tab === 'social' && !loading) load(); }, 30000);

  // ---------- messages ----------
  const unreadFrom = uid => msgs.filter(m => m.sender === uid && m.recipient === me.id && !m.read_at).length;
  const unreadAll = () => me ? msgs.filter(m => m.recipient === me.id && !m.read_at && accepted().some(f => otherOf(f) === m.sender)).length : 0;
  const thread = uid => msgs.filter(m => (m.sender === uid && m.recipient === me.id) || (m.sender === me.id && m.recipient === uid));
  async function markRead(uid){
    const un = msgs.filter(m => m.sender === uid && m.recipient === me.id && !m.read_at); if (!un.length) return;
    const t = new Date().toISOString(); un.forEach(m => m.read_at = t); paintBadge();
    await sb().from('goliath_messages').update({read_at: t}).eq('sender', uid).eq('recipient', me.id).is('read_at', null);
  }
  async function sendMsg(uid, body){
    body = body.trim().slice(0, 1000); if (!body) return false;
    const tmp = {id: 'tmp' + Date.now() + Math.random(), sender: me.id, recipient: uid, body, created_at: new Date().toISOString(), read_at: null, pending: true};
    msgs.push(tmp); if (chat === uid) paintChat(true);
    const {data, error} = await sb().from('goliath_messages').insert({sender: me.id, recipient: uid, body}).select().maybeSingle();
    const i = msgs.indexOf(tmp);
    if (error || !data){ if (i >= 0) msgs.splice(i, 1); if (chat === uid) paintChat(); toast(navigator.onLine ? 'Message not sent. Try again.' : 'You are offline. Message not sent.'); return false; }
    if (msgs.some(m => m.id === data.id)) msgs.splice(i, 1); else msgs[i] = data;
    if (chat === uid) paintChat();
    return true;
  }
  function onMsg(m){
    if (!m || msgs.some(x => x.id === m.id)) return;
    msgs.push(m);
    if (m.recipient === me.id){
      if (chat === m.sender && S.tab === 'social' && document.visibilityState === 'visible') markRead(m.sender);
      else { toast(`${nameOf(m.sender)}: ${m.body.slice(0, 70)}`); if (navigator.vibrate) try { navigator.vibrate(60); } catch(e){} }
    }
    paintBadge(); if (S.tab === 'social') renderSocial();
  }
  function onMsgUpdate(m){ const x = msgs.find(y => y.id === m.id); if (x){ x.read_at = m.read_at; if (chat === x.recipient) paintChat(); } }
  function subscribe(){
    unsubscribe();
    try {
      rt = sb().channel('goliath-dm-' + me.id)
        .on('postgres_changes', {event: 'INSERT', schema: 'public', table: 'goliath_messages', filter: 'recipient=eq.' + me.id}, p => onMsg(p.new))
        .on('postgres_changes', {event: 'UPDATE', schema: 'public', table: 'goliath_messages', filter: 'sender=eq.' + me.id}, p => onMsgUpdate(p.new))
        .subscribe(st => { rtOk = st === 'SUBSCRIBED'; });
    } catch(e){ rtOk = false; }
  }
  function unsubscribe(){ if (rt){ try { sb().removeChannel(rt); } catch(e){} rt = null; } rtOk = false; }
  // if the live connection is down, check for new messages every few seconds while a chat is open
  async function pullMsgs(){
    if (!me) return;
    const since = msgs.filter(m => !m.pending).reduce((t, m) => m.created_at > t ? m.created_at : t, new Date(Date.now() - 90 * 864e5).toISOString());
    const {data} = await sb().from('goliath_messages').select('*').gte('created_at', since).order('created_at', {ascending: true}).limit(200);
    (data || []).forEach(m => { const x = msgs.find(y => y.id === m.id); if (x) x.read_at = m.read_at; else onMsg(m); });
    if (chat) paintChat();
  }
  setInterval(() => { if (me && chat && !rtOk && S.tab === 'social' && document.visibilityState === 'visible') pullMsgs(); }, 5000);

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

  // ---------- programs ----------
  // what you can send: each of your builds, plus the suggested plan as a week
  function progChoices(){
    const out = builds().filter(b => b.phases.some(p => p.days.some(d => d.items && d.items.length)))
      .map(b => ({key: 'b:' + b.id, name: b.name, kind: b.kind, sum: KIND_N[b.kind] + ' · ' + buildSummary(b), b}));
    if (PLAN) out.push({key: 'plan', name: 'My suggested plan', kind: 'week', sum: `Week · ${PLAN.days_.length} days a week`, plan: true});
    return out;
  }
  function payloadOf(c){
    if (c.plan) return {kind: 'week', prog: 'load', deload: 0, phases: [{name: 'Phase 1', weeks: 1, days: PLAN.days_.map(pd => ({name: pd.name, items: pd.blocks.flatMap(bl => bl.items.map((it, j) => ({n: it.e.name, g: it.e.g, sets: it.sets, reps: it.pyr ? String(it.reps) : it.reps, rest: it.rest, ss: bl.items.length > 1 && j < bl.items.length - 1})))}))}]};
    const b = c.b;
    return {kind: b.kind, prog: b.prog || 'load', deload: b.deload || 0, phases: b.phases.map(p => ({name: p.name, weeks: p.weeks, days: p.days.map(d => ({name: d.name, items: (d.items || []).map(x => Object.assign({}, x))}))}))};
  }
  function shareSummary(sh){
    const ph = (sh.program.phases || []), days = (ph[0] && ph[0].days) || [], ex = days.reduce((t, d) => t + (d.items || []).length, 0);
    if (sh.kind === 'day') return `Single workout · ${ex} exercise${ex === 1 ? '' : 's'}`;
    if (sh.kind === 'week') return `Week · ${days.length} day${days.length === 1 ? '' : 's'} a week · ${ex} exercises`;
    return `Program · ${ph.reduce((t, p) => t + (+p.weeks || 0), 0)} weeks · ${ph.length} phase${ph.length === 1 ? '' : 's'}`;
  }
  function addShare(sh){
    const pr = sh.program || {}, taken = new Set(builds().map(b => b.name));
    let name = sh.name; if (taken.has(name)) name = `${sh.name} (from ${(sh.sender_name || 'a friend').split(' ')[0]})`;
    const b = {id: uid('b'), name: name.slice(0, 60), kind: ['day', 'week', 'program'].includes(sh.kind) ? sh.kind : 'week', prog: pr.prog || 'load', deload: +pr.deload || 0,
      phases: (pr.phases || []).map(p => ({id: uid('p'), name: String(p.name || 'Phase 1').slice(0, 40), weeks: Math.max(1, Math.min(16, +p.weeks || 1)),
        days: (p.days || []).map(d => ({id: uid('d'), name: String(d.name || 'Workout').slice(0, 40), items: (d.items || []).filter(x => x && typeof x.n === 'string' && GROUPS[x.g]).map(x => ({n: x.n, g: x.g, sets: Math.max(1, Math.min(10, +x.sets || 3)), reps: String(x.reps || '8–12').slice(0, 20), rest: Math.max(15, Math.min(600, +x.rest || 90)), ss: !!x.ss}))}))}))};
    if (!b.phases.length) b.phases = [{id: uid('p'), name: 'Phase 1', weeks: 1, days: [{id: uid('d'), name: 'Workout', items: []}]}];
    builds().push(b); save(); rebuild();
    return b;
  }

  // "Send to a friend" inside an open build
  const _rbt = renderBuildTab;
  renderBuildTab = function(){
    _rbt.apply(this, arguments);
    if (!me || !S.bId || !accepted().length) return;
    const h = document.querySelector('#tabBuild .bhead'); if (!h || h.querySelector('[data-bsend]')) return;
    const b = document.createElement('button'); b.className = 'chip sm'; b.dataset.bsend = S.bId; b.textContent = 'Send to a friend';
    b.addEventListener('click', e => { e.stopPropagation(); send = {prog: 'b:' + S.bId, friend: accepted().length === 1 ? otherOf(accepted()[0]) : null, note: ''}; S.tab = 'social'; window.scrollTo(0, 0); render(); });
    h.appendChild(b);
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
      <div class="pp">${avHTML(w.user_id, who ? 'me' : '')}<span><b>${esc(nameOf(w.user_id))}</b><small>${esc(ago(w.done_at))}</small></span></div>
      <div class="what">Finished <b>${esc(w.day_name)}</b>${w.plan_name ? ` · ${esc(w.plan_name)}` : ''}</div>
      ${w.highlights && w.highlights.length ? `<div class="hl">${w.highlights.map(h => `<span>${esc(h.n)} ${esc(h.w)}${w.unit === 'kg' ? ' kg' : ''} × ${esc(h.r)}</span>`).join('')}</div>` : ''}
      <div class="meta">${w.rating ? `<span class="rate-chip">${w.rating}/5 · ${esc(RATE_N(w.rating))}</span>` : ''}${w.sets_done ? `<span>${w.sets_done} sets</span>` : ''}${!who ? (() => { const done = cheerSent(w); return `<span style="margin-left:auto"><button class="cheer" data-soc="cheer" data-id="${w.id}" ${done ? 'disabled' : ''}>${done ? 'Cheered' : '💪 Cheer'}</button></span>`; })() : ''}</div>
    </div>`;
  }
  const cheerText = w => `💪 Nice work on ${w.day_name}!`;
  const cheerSent = w => thread(w.user_id).some(m => m.sender === me.id && m.body === cheerText(w) && m.created_at >= w.done_at);
  function weekDots(uid){
    const since = Date.now() - 7 * 864e5, n = feed.filter(w => w.user_id === uid && Date.parse(w.done_at) > since).length;
    return {n, html: `<span class="wkdots" aria-label="${n} workout${n === 1 ? '' : 's'} in the last 7 days">${[0,1,2,3,4,5].map(i => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`};
  }
  function renderSocial(){
    if (!me){ main.innerHTML = ''; return; }
    if (chat) return renderChat();
    const keep = main.querySelector('#socEmail'), kv = keep ? keep.value : '', kf = keep && document.activeElement === keep;
    const nk = main.querySelector('#socNote'); if (nk && send) send.note = nk.value;
    const inc = incoming(), out = outgoing(), acc = accepted();
    const mine = weekDots(me.id);
    const live = acc.map(otherOf).filter(u => u && presenceOf(u).on);
    const showAdd = addOpen || (loaded && !acc.length && !out.length && !inc.length && !addTouched);
    main.innerHTML = `<div class="soc">
      <div class="soc-head"><div><div class="eyebrow">Social</div><h1 class="display">Your crew</h1></div>
        <div class="soc-acts"><button class="icobtn add" data-soc="addtoggle" aria-expanded="${showAdd}" aria-controls="socAdd" aria-label="Add a friend"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/><path d="M19 8v6M16 11h6"/></svg></button><button class="icobtn" data-soc="settoggle" aria-expanded="${setOpen}" aria-controls="socSet" aria-label="Social settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button></div></div>
      ${setOpen ? `<div class="panel sets" id="socSet"><div class="eyebrow">Settings</div>
        <div class="switch"><div><b>Show when I'm online</b><br><span>${profile && profile.presence === false ? 'Friends can\'t see when you\'re on the app.' : 'Friends see a green dot, and "Working out" while you log sets.'}</span></div><button role="switch" aria-checked="${!(profile && profile.presence === false)}" aria-label="Show when I'm online" data-soc="presence"></button></div>
        <div class="switch"><div><b>Share my workouts</b><br><span>${profile && profile.share === false ? 'Friends can\'t see your workouts right now.' : 'Friends see each workout you finish.'}</span></div><button role="switch" aria-checked="${!(profile && profile.share === false)}" aria-label="Share my workouts with friends" data-soc="share"></button></div>
        <p class="hint" style="text-align:left;margin:0">Friends only ever see workouts you finish in the Gym tab, never your body stats, injuries or notes.</p></div>` : ''}
      ${showAdd || formMsg ? `<form class="panel add" id="socAdd" novalidate>
        <label class="eyebrow" for="socEmail">Add a friend by email</label>
        <div class="inrow"><input id="socEmail" type="email" inputmode="email" autocomplete="off" placeholder="friend@email.com" aria-label="Friend's email"><button class="btn" type="submit" ${sending ? 'disabled' : ''}>${sending ? 'Sending…' : 'Send'}</button></div>
        ${formMsg ? `<div class="msg ${formMsg.k}" role="status">${esc(formMsg.t)}</div>` : '<span class="hint" style="text-align:left">They see your request next time they open Goliath. If they don\'t have an account yet, it waits for them.</span>'}
      </form>` : ''}
      ${send ? sendPanel() : ''}
      ${shares.length ? `<div class="panel"><h3>Programs for you</h3>${shares.map(sh => `<div class="shr"><div class="pp"><span class="av" aria-hidden="true">${esc((sh.sender_name || '?')[0].toUpperCase())}</span><span><b>${esc(sh.name)}</b><small>From ${esc(sh.sender_name || 'a friend')} · ${esc(shareSummary(sh))} · ${esc(ago(sh.created_at))}</small></span></div>${sh.note ? `<q>${esc(sh.note)}</q>` : ''}<div class="row"><button class="chip sm ink on" style="flex:none" data-soc="shadd" data-id="${sh.id}">Add to my builds</button><button class="chip sm" style="flex:none" data-soc="shdrop" data-id="${sh.id}">Dismiss</button></div></div>`).join('')}</div>` : ''}
      ${err ? `<div class="panel" role="alert" style="color:var(--red)">${esc(err)}</div>` : ''}
      ${inc.length ? `<div class="panel"><h3>Friend requests</h3>${inc.map(f => `<div class="req"><div class="pp"><span class="av" aria-hidden="true">${esc((f.requester_name || f.requester_email)[0].toUpperCase())}</span><span><b>${esc(f.requester_name || f.requester_email)}</b><small>${esc(f.requester_email)} wants to share workouts</small></span></div><div class="row"><button class="chip sm ink on" data-soc="accept" data-id="${f.id}">Accept</button><button class="chip sm" data-soc="decline" data-id="${f.id}">Decline</button></div></div>`).join('')}</div>` : ''}
      <div class="panel"><h3>This week</h3>
        <div class="fr"><div class="pp">${avHTML(me.id, 'me')}<span><b>You</b><small>${mine.n} workout${mine.n === 1 ? '' : 's'} in the last 7 days</small></span>${mine.html}</div></div>
        ${acc.map(f => { const uid = otherOf(f); if (!uid) return ''; const d = weekDots(uid); const last = feed.find(w => w.user_id === uid); const isOpen = open === uid;
          const pr = presenceOf(uid), un = unreadFrom(uid), lm = thread(uid).slice(-1)[0];
          const line = un && lm ? {c: 'new', t: lm.body} : pr.on ? {c: 'live', t: pr.txt} : last ? {c: '', t: `Last: ${last.day_name}, ${ago(last.done_at)}`} : pr.txt ? {c: '', t: pr.txt} : {c: '', t: 'No workouts shared yet'};
          return `<div class="fr"><div class="frrow"><button class="pp" data-soc="open" data-uid="${uid}" aria-expanded="${isOpen}">${avHTML(uid)}<span><b>${esc(nameOf(uid))}</b><small class="${line.c}">${esc(line.t)}</small></span>${d.html}</button><button class="msgbtn" data-soc="chat" data-uid="${uid}" aria-label="Message ${esc(nameOf(uid))}${un ? `, ${un} unread` : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/></svg>${un ? `<span class="tab-dot">${un}</span>` : ''}</button></div>
          ${isOpen ? `${feed.filter(w => w.user_id === uid).slice(0, 5).map(wkCard).join('') || '<p class="empty">Nothing in the last 4 weeks.</p>'}<div class="row" style="flex-wrap:wrap"><button class="chip sm ink on" style="flex:none" data-soc="chat" data-uid="${uid}">Message</button><button class="chip sm" style="flex:none" data-soc="sendto" data-uid="${uid}">Send a program</button>${confirmRemove === f.id ? `<button class="chip sm" style="color:var(--red);flex:none" data-soc="remove" data-id="${f.id}">Remove ${esc(nameOf(uid))}</button><button class="chip sm" style="flex:none" data-soc="keep">Keep</button>` : `<button class="chip sm" style="flex:none" data-soc="askremove" data-id="${f.id}">Remove friend</button>`}</div>` : ''}</div>`; }).join('')}
        ${!acc.length ? `<p class="empty">${loaded ? 'No friends yet. Tap the + button up top to add someone by email.' : 'Loading…'}</p>` : ''}
      </div>
      ${acc.length ? `<div class="panel"><div class="eyebrow" style="margin-bottom:10px">Online now</div>${live.length ? `<div class="online-strip">${live.map(u => `<button data-soc="chat" data-uid="${u}" aria-label="Message ${esc(nameOf(u))}, ${esc(presenceOf(u).txt)}">${avHTML(u)}<small>${esc(nameOf(u).split(' ')[0])}</small></button>`).join('')}</div>` : '<p class="empty" style="margin:0;padding:0">No friends online right now.</p>'}</div>` : ''}
      ${acc.length && !send ? `<button class="btn ghost" data-soc="sendopen">Send a program to a friend</button>` : ''}
      ${acc.length ? `<div><div class="eyebrow" style="margin:4px 0 10px">Recent workouts</div><div style="display:grid;gap:10px">${feed.slice(0, 25).map(wkCard).join('') || '<p class="empty">No workouts yet. Finish one in the Gym tab and it shows up here.</p>'}</div></div>` : ''}
      ${out.length ? `<div class="panel"><h3>Waiting for a reply</h3>${out.map(f => `<div class="req"><div class="pp"><span class="av" aria-hidden="true" style="background:var(--muted)">${esc(f.addressee_email[0].toUpperCase())}</span><span><b>${esc(f.addressee_email)}</b><small>Sent ${esc(ago(f.created_at))}</small></span><button class="chip sm" style="flex:none" data-soc="cancel" data-id="${f.id}">Cancel</button></div></div>`).join('')}</div>` : ''}
    </div>`;
    if (kv || kf){ const el = main.querySelector('#socEmail'); if (el){ el.value = kv; if (kf) el.focus(); } }
  }

  // ---------- chat screen ----------
  function dayLabel(t){
    const d = new Date(t), n = new Date(), y = new Date(); y.setDate(n.getDate() - 1);
    if (d.toDateString() === n.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric'});
  }
  const clock = t => new Date(t).toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});
  function renderChat(){
    const uid = chat, f = accepted().find(x => otherOf(x) === uid);
    if (!f){ chat = null; return renderSocial(); }
    let shell = main.querySelector('#chatShell');
    if (!shell || shell.dataset.uid !== uid){
      main.innerHTML = `<div class="soc chat" id="chatShell" data-uid="${uid}">
        <div class="chat-head"><button class="chip sm" data-soc="chatback">‹ Crew</button><div class="pp" id="chatWho"></div></div>
        <div class="chat-list" id="chatList" role="log" aria-live="polite" aria-label="Messages with ${esc(nameOf(uid))}"></div>
        <form class="chat-comp" id="chatForm"><textarea id="chatIn" rows="1" maxlength="1000" placeholder="Message ${esc(nameOf(uid).split(' ')[0])}" aria-label="Message ${esc(nameOf(uid))}"></textarea><button class="btn" type="submit">Send</button></form>
      </div>`;
      paintChat(true, true);
    } else paintChat();
  }
  function paintChat(toEnd, first){
    const uid = chat, list = main.querySelector('#chatList'); if (!list || !uid) return;
    const tb = document.querySelector('.tabbar'), hd = document.querySelector('header.top');
    document.documentElement.style.setProperty('--tbh', (tb ? tb.offsetHeight : 72) + 'px');
    document.documentElement.style.setProperty('--hdr', (hd && getComputedStyle(hd).position === 'sticky' ? hd.offsetHeight : 0) + 'px');
    const pr = presenceOf(uid);
    main.querySelector('#chatWho').innerHTML = `${avHTML(uid)}<span><b>${esc(nameOf(uid))}</b><small class="${pr.on ? 'live' : ''}">${esc(pr.txt || 'Friends since ' + dayLabel(accepted().find(x => otherOf(x) === uid).created_at))}</small></span>`;
    const nearEnd = window.innerHeight + window.scrollY > document.documentElement.scrollHeight - 140;
    const T = thread(uid);
    let html = '', lastDay = '';
    const lastMine = [...T].reverse().find(m => m.sender === me.id);
    T.forEach((m, i) => {
      const dl = dayLabel(m.created_at); if (dl !== lastDay){ html += `<div class="chat-day">${esc(dl)}</div>`; lastDay = dl; }
      const mine = m.sender === me.id, nx = T[i + 1];
      html += `<div class="bub${mine ? ' mine' : ''}${m.pending ? ' pending' : ''}">${esc(m.body)}</div>`;
      const gap = !nx || nx.sender !== m.sender || Date.parse(nx.created_at) - Date.parse(m.created_at) > 5 * 60000 || dayLabel(nx.created_at) !== dl;
      if (gap) html += `<div class="bub-t${mine ? ' mine' : ''}">${m.pending ? 'Sending…' : clock(m.created_at)}${m === lastMine && m.read_at ? ' · Seen' : ''}</div>`;
    });
    if (!T.length) html = `<div class="chat-empty">Say hi to ${esc(nameOf(uid).split(' ')[0])}. Only the two of you can see these messages.<div class="quick" style="justify-content:center;margin-top:14px">${['💪 Gym today?', 'What time are you going?', 'Want to train together this week?'].map(q => `<button class="chip sm" data-soc="quick" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div></div>`;
    list.innerHTML = html;
    if (toEnd || nearEnd) requestAnimationFrame(() => window.scrollTo(0, document.documentElement.scrollHeight));
    if (first){ markRead(uid); const ta = main.querySelector('#chatIn'); if (ta && matchMedia('(pointer:fine)').matches) ta.focus(); }
  }
  function openChat(uid){ chat = uid; S.tab = 'social'; render(); markRead(uid); if (!rtOk) pullMsgs(); }
  function sendPanel(){
    const C = progChoices(), F = accepted().map(otherOf).filter(Boolean);
    if (send.prog && !C.some(c => c.key === send.prog)) send.prog = null;
    if (!send.prog && C.length === 1) send.prog = C[0].key;
    const ready = send.prog && send.friend && !send.busy;
    return `<div class="panel send" style="display:grid;gap:12px" id="socSend"><h3 style="margin:0">Send a program</h3>
      ${C.length ? `<div class="eyebrow">Which one</div><div class="pg-pick">${C.map(c => `<button class="pg-opt" aria-pressed="${send.prog === c.key}" data-soc="pickprog" data-k="${esc(c.key)}"><span><b>${esc(c.name)}</b><small>${esc(c.sum)}</small></span></button>`).join('')}</div>`
        : `<p class="empty" style="margin:0">You have nothing to send yet. Make a workout, week or program in the Build tab, or answer the questions in My program to get a suggested plan.</p>`}
      <div class="eyebrow">To</div><div class="pg-pick">${F.map(u => `<button class="pg-opt" aria-pressed="${send.friend === u}" data-soc="pickfriend" data-uid="${u}"><span class="av" aria-hidden="true">${esc(initialOf(u))}</span><span><b>${esc(nameOf(u))}</b></span></button>`).join('')}</div>
      <div class="field"><label for="socNote">Note (optional)</label><textarea id="socNote" maxlength="300" placeholder="e.g. This is the arm day I told you about. Go lighter on the skull crushers.">${esc(send.note || '')}</textarea></div>
      <p class="hint" style="text-align:left;margin:0">They get a copy to add to their Build tab. Weights aren't included, and changes they make won't touch yours.</p>
      <div class="row"><button class="btn" style="flex:1" data-soc="sendgo" ${ready ? '' : 'disabled'}>${send.busy ? 'Sending…' : 'Send'}</button><button class="btn ghost" style="flex:none;padding-inline:20px" data-soc="sendx">Cancel</button></div></div>`;
  }
  main.addEventListener('submit', async e => {
    e.preventDefault();
    if (e.target.id === 'chatForm'){
      const ta = main.querySelector('#chatIn'), v = ta.value; if (!v.trim()) return;
      ta.value = ''; ta.style.height = ''; ta.focus();
      if (!(await sendMsg(chat, v)) && !ta.value) ta.value = v;
      return;
    }
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
  main.addEventListener('keydown', e => {
    if (e.target.id === 'chatIn' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer:fine)').matches){ e.preventDefault(); main.querySelector('#chatForm').requestSubmit(); }
  });
  main.addEventListener('input', e => {
    if (e.target.id === 'chatIn'){ const t = e.target; t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight + 3) + 'px'; return; } if (e.target.id === 'socEmail' && formMsg){ formMsg = null; const m = main.querySelector('.soc .msg'); if (m) m.remove(); } });
  main.addEventListener('click', async e => {
    const b = e.target.closest('[data-soc]'); if (!b) return;
    const a = b.dataset.soc, id = b.dataset.id;
    if (a === 'open'){ open = open === b.dataset.uid ? null : b.dataset.uid; confirmRemove = null; return renderSocial(); }
    if (a === 'askremove'){ confirmRemove = id; return renderSocial(); }
    if (a === 'addtoggle'){ addOpen = !(main.querySelector('#socAdd')); addTouched = true; formMsg = null; renderSocial(); if (addOpen){ const el = main.querySelector('#socEmail'); if (el) el.focus(); } return; }
    if (a === 'settoggle'){ setOpen = !setOpen; return renderSocial(); }
    if (a === 'chat'){ open = null; return openChat(b.dataset.uid); }
    if (a === 'chatback'){ chat = null; renderSocial(); window.scrollTo(0, 0); return; }
    if (a === 'quick'){ return sendMsg(chat, b.dataset.q); }
    if (a === 'cheer'){ const w = feed.find(x => x.id === id); if (!w) return; b.disabled = true; b.textContent = 'Cheered'; if (await sendMsg(w.user_id, cheerText(w))) toast(`Cheer sent to ${nameOf(w.user_id)}`); else { b.disabled = false; b.textContent = '💪 Cheer'; } return renderSocial(); }
    if (a === 'keep'){ confirmRemove = null; return renderSocial(); }
    const keepNote = () => { const n = main.querySelector('#socNote'); if (n && send) send.note = n.value; };
    if (a === 'sendopen' || a === 'sendto'){ send = {prog: null, friend: b.dataset.uid || (accepted().length === 1 ? otherOf(accepted()[0]) : null), note: ''}; renderSocial(); main.querySelector('#socSend').scrollIntoView({block: 'start'}); return; }
    if (a === 'pickprog'){ keepNote(); send.prog = b.dataset.k; return renderSocial(); }
    if (a === 'pickfriend'){ keepNote(); send.friend = b.dataset.uid; return renderSocial(); }
    if (a === 'sendx'){ send = null; return renderSocial(); }
    if (a === 'sendgo'){
      keepNote(); const c = progChoices().find(x => x.key === send.prog); if (!c || !send.friend) return;
      send.busy = true; renderSocial();
      const {error} = await sb().from('goliath_program_shares').insert({sender: me.id, sender_name: myName() || myEmail(), recipient: send.friend, name: (c.plan ? `${(myName() || 'Friend').split(' ')[0]}'s suggested plan` : c.name).slice(0, 80), kind: c.kind, note: (send.note || '').trim().slice(0, 300), program: payloadOf(c)});
      if (error){ send.busy = false; toast('Could not send. Try again.'); return renderSocial(); }
      toast(`Sent ${c.name} to ${nameOf(send.friend)}`); send = null; return renderSocial();
    }
    if (a === 'shadd'){
      const sh = shares.find(x => x.id === id); if (!sh) return;
      const nb = addShare(sh); await sb().from('goliath_program_shares').delete().eq('id', id); shares = shares.filter(x => x.id !== id); paintBadge();
      toast(`${nb.name} added to Build`); S.tab = 'build'; S.bId = nb.id; S.bPh = 0; S.bDay = 0; window.scrollTo(0, 0); render(); return;
    }
    b.disabled = true;
    if (a === 'accept'){ const {error} = await sb().from('goliath_friends').update({status: 'accepted', addressee: me.id}).eq('id', id); toast(error ? 'Could not accept. Try again.' : 'You\'re now friends'); }
    if (a === 'shdrop'){ await sb().from('goliath_program_shares').delete().eq('id', id); shares = shares.filter(x => x.id !== id); paintBadge(); toast('Dismissed'); return renderSocial(); }
    if (a === 'decline' || a === 'cancel' || a === 'remove'){ const {error} = await sb().from('goliath_friends').delete().eq('id', id); confirmRemove = null; open = null; toast(error ? 'Could not update. Try again.' : a === 'remove' ? 'Friend removed' : a === 'cancel' ? 'Request cancelled' : 'Request declined'); }
    if (a === 'presence'){
      const next = profile && profile.presence === false;
      const {error} = await sb().from('goliath_profiles').update(next ? {presence: true, last_seen: new Date().toISOString(), activity: myActivity()} : {presence: false, last_seen: null, activity: 'off'}).eq('user_id', me.id);
      if (!error){ profile.presence = next; toast(next ? 'Friends can see when you\'re online' : 'Online status hidden'); } else toast('Could not change that. Try again.');
      return renderSocial();
    }
    if (a === 'share'){ const next = !(profile && profile.share === false) ? false : true; const {error} = await sb().from('goliath_profiles').update({share: next}).eq('user_id', me.id); if (!error){ profile.share = next; toast(next ? 'Sharing your workouts' : 'Workouts hidden from friends'); } else toast('Could not change sharing. Try again.'); return renderSocial(); }
    formMsg = null; await load();
  });

  // ---------- lifecycle ----------
  window.addEventListener('goliath:signin', async e => {
    me = e.detail; tb.hidden = false;
    try { await ensureProfile(); await claimRequests(); } catch(err){}
    subscribe(); beat(); load();
  });
  window.addEventListener('goliath:signout', () => {
    unsubscribe(); chat = null; msgs = [];
    me = null; profile = null; addOpen = false; addTouched = false; setOpen = false; friends = []; shares = []; send = null; feed = []; profiles = {}; loaded = false; open = null; formMsg = null;
    tb.hidden = true; paintBadge(); if (S.tab === 'social'){ S.tab = 'body'; render(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (!me) return;
    beat();                                            // 'off' when hidden, so friends see you leave right away
    if (document.visibilityState === 'visible'){ if (!rtOk) subscribe(); load(); }
  });
  if (AUTH.user){ me = AUTH.user; tb.hidden = false; ensureProfile().then(claimRequests).then(() => { subscribe(); beat(); load(); }).catch(load); }
})();
