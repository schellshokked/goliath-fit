// Goliath notifications: turn push on for this phone, choose what to hear about, and open the right screen from a tap.
(function(){
  const AUTH = window.__goliathAuth, CFG = window.GOLIATH_SUPABASE || {};
  if (!AUTH) return;
  const sb = () => AUTH.sb;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const TYPES = [['messages', 'Messages and cheers', 'When a friend messages you'], ['requests', 'Friend requests', 'New requests, and when someone accepts yours'], ['programs', 'Programs sent to you', 'When a friend sends you a workout'], ['friend_workouts', "Friends' workouts", 'When a friend finishes a workout']];
  let prefs = null, sub = null, open = false, busy = false, msg = null;
  const DEFP = {messages: true, requests: true, programs: true, friend_workouts: true, reminders: false, remind_days: [], remind_time: '18:00:00', weekly: true};
  const cur = () => Object.assign({}, DEFP, prefs || {});

  const css = document.createElement('style');
  css.textContent = `
  .nt-back{position:fixed;inset:0;z-index:20;background:color-mix(in srgb,#000 45%,transparent);display:grid;align-items:end;justify-items:center}
  .nt{background:var(--bg);width:100%;max-width:520px;max-height:92dvh;overflow:auto;border-radius:20px 20px 0 0;padding:18px max(16px,env(safe-area-inset-right,0px)) calc(24px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));display:grid;gap:12px}
  @media (min-width:600px){.nt-back{align-items:center}.nt{border-radius:20px}}
  .nt-h{display:flex;justify-content:space-between;align-items:center;gap:12px}
  .nt-h h2{font:800 30px/1 var(--f-display);text-transform:uppercase;margin:0}
  .nt-x{width:40px;height:40px;border-radius:50%;border:1.5px solid var(--line);background:var(--surface);font-size:20px;line-height:1;padding:0}
  .nt .switch{display:flex;align-items:center;justify-content:space-between;gap:12px}
  .nt .switch + .switch{border-top:1px solid var(--line);padding-top:12px;margin-top:12px}
  .nt .switch span{font-size:13.5px;color:var(--muted)}
  .nt .switch button{flex:none;width:52px;height:30px;border-radius:15px;border:0;background:var(--line);position:relative;padding:0}
  .nt .switch button::after{content:"";position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:var(--surface);transition:left .15s}
  .nt .switch button[aria-checked="true"]{background:var(--green)}
  .nt .switch button[aria-checked="true"]::after{left:25px}
  .nt .switch button:disabled{opacity:.4}
  .nt-days{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
  .nt-days .chip{min-width:44px;justify-content:center;display:inline-flex}
  .nt-time{display:flex;align-items:center;gap:10px;margin-top:10px;font-size:14px;color:var(--muted)}
  .nt-time input{border:1.5px solid var(--line);background:var(--surface-2);color:var(--ink);border-radius:10px;padding:9px 10px;font:600 16px var(--f-mono)}
  .nt-st{display:flex;gap:10px;align-items:flex-start;font-size:14px}
  .nt-st i{width:10px;height:10px;border-radius:50%;background:var(--muted);flex:none;margin-top:5px}
  .nt-st.on i{background:var(--green)} .nt-st.off i{background:var(--yellow)} .nt-st.bad i{background:var(--red)}
  .nt .msg{font-size:13.5px;padding:8px 10px;border-radius:8px;background:var(--surface-2)}
  .nt-nudge{display:flex;align-items:center;gap:12px}
  .nt-nudge p{margin:0;flex:1;font-size:14px}
  .nt-nudge .btn{width:auto;flex:none;padding:10px 14px;font-size:14px}`;
  document.head.appendChild(css);
  const back = document.createElement('div'); back.className = 'nt-back'; back.hidden = true;
  back.innerHTML = '<div class="nt" role="dialog" aria-modal="true" aria-labelledby="ntTitle"></div>';
  document.body.appendChild(back);
  const box = back.firstElementChild;

  const b64 = s => { const p = '='.repeat((4 - s.length % 4) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, c => c.charCodeAt(0)); };
  const perm = () => supported ? Notification.permission : 'unsupported';
  async function reg(){ return navigator.serviceWorker && (await navigator.serviceWorker.getRegistration()) || null; }
  async function loadState(){
    if (!AUTH.user) return;
    const {data} = await sb().from('goliath_notify_prefs').select('*').eq('user_id', AUTH.user.id).maybeSingle();
    prefs = data || null;
    const r = supported ? await reg() : null; sub = r ? await r.pushManager.getSubscription() : null;
  }
  async function savePrefs(patch){
    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'America/New_York';
    const row = Object.assign({user_id: AUTH.user.id, tz, updated_at: new Date().toISOString()}, patch);
    const {data, error} = prefs
      ? await sb().from('goliath_notify_prefs').update(row).eq('user_id', AUTH.user.id).select().maybeSingle()
      : await sb().from('goliath_notify_prefs').insert(row).select().maybeSingle();
    if (error){ toast('Could not save that. Try again.'); return false; }
    prefs = data; return true;
  }
  async function turnOn(){
    if (!supported){ msg = 'This browser can\'t show notifications. On Android, open Goliath from your home screen in Chrome.'; return paint(); }
    if (!CFG.vapidPublicKey){ msg = 'Notifications aren\'t set up on the server yet.'; return paint(); }
    busy = true; paint();
    try {
      const p = await Notification.requestPermission();
      if (p !== 'granted'){ busy = false; msg = p === 'denied' ? 'Notifications are blocked for Goliath. Turn them on in your phone\'s settings (Settings → Apps → Goliath → Notifications), then come back.' : 'Notifications weren\'t allowed.'; return paint(); }
      const r = await navigator.serviceWorker.ready;
      sub = await r.pushManager.getSubscription() || await r.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: b64(CFG.vapidPublicKey)});
      const j = sub.toJSON();
      const {error} = await sb().rpc('goliath_save_push_sub', {p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent});
      if (error) throw error;
      if (!prefs) await savePrefs({});
      msg = null; toast('Notifications are on');
    } catch(e){ msg = 'Could not turn on notifications. Check your connection and try again.'; }
    busy = false; paint();
  }
  async function turnOff(){
    busy = true; paint();
    try {
      if (sub){ const ep = sub.endpoint; await sub.unsubscribe(); await sb().from('goliath_push_subs').delete().eq('endpoint', ep); }
      sub = null; toast('Notifications off on this phone');
    } catch(e){ toast('Could not turn them off. Try again.'); }
    busy = false; paint();
  }
  async function test(){
    busy = true; paint();
    const {data, error} = await sb().functions.invoke('goliath-push', {body: {kind: 'test'}});
    busy = false;
    msg = error ? 'The test didn\'t go through. Try again in a minute.' : data && data.sent ? 'Test sent. It should appear in a few seconds.' : 'No phone is signed up yet. Turn notifications on first.';
    paint();
  }

  function sw(key, title, desc, on, dis){ return `<div class="switch"><div><b>${title}</b><br><span>${desc}</span></div><button role="switch" aria-checked="${!!on}" aria-label="${title}" data-nt="${key}" ${dis ? 'disabled' : ''}></button></div>`; }
  function paint(){
    if (!open) return;
    const P = cur();
    const pm = perm(), on = !!sub && pm === 'granted';
    const st = pm === 'unsupported' ? ['bad', 'This browser can\'t show notifications. Open Goliath from your home screen in Chrome.'] : pm === 'denied' ? ['bad', 'Blocked in your phone\'s settings. Allow notifications for Goliath there, then come back.'] : on ? ['on', 'On for this phone.'] : ['off', 'Off on this phone.'];
    const days = P.remind_days || [], t = String(P.remind_time || '18:00').slice(0, 5);
    box.innerHTML = `<div class="nt-h"><h2 id="ntTitle">Notifications</h2><button class="nt-x" data-nt="close" aria-label="Close">×</button></div>
      <div class="panel" style="display:grid;gap:12px"><div class="nt-st ${st[0]}"><i aria-hidden="true"></i><span>${st[1]}</span></div>
        ${on ? `<div class="row"><button class="btn ghost" data-nt="test" ${busy ? 'disabled' : ''}>Send a test</button><button class="btn ghost" style="flex:none;width:auto;padding-inline:16px" data-nt="off" ${busy ? 'disabled' : ''}>Turn off</button></div>` : pm !== 'unsupported' && pm !== 'denied' ? `<button class="btn" data-nt="on" ${busy ? 'disabled' : ''}>${busy ? 'Turning on…' : 'Turn on notifications'}</button>` : ''}
        ${msg ? `<div class="msg" role="status">${esc(msg)}</div>` : ''}</div>
      <div class="panel"><div class="eyebrow" style="margin-bottom:10px">From your crew</div>${TYPES.map(([k, n, d]) => sw(k, n, d, P[k], !on)).join('')}</div>
      <div class="panel"><div class="eyebrow" style="margin-bottom:10px">For you</div>
        ${sw('reminders', 'Training reminders', 'A nudge on the days you train, skipped if you\'ve already worked out', P.reminders, !on)}
        ${P.reminders && on ? `<div class="nt-days" role="group" aria-label="Reminder days">${DAYS.map((d, i) => `<button class="chip sm ${days.includes(i) ? 'on' : ''}" aria-pressed="${days.includes(i)}" data-ntday="${i}">${d}</button>`).join('')}</div>
          <label class="nt-time">Remind me at <input type="time" id="ntTime" value="${t}" step="900"></label>${!days.length ? '<span class="hint" style="text-align:left;font-size:13px;color:var(--red)">Pick at least one day.</span>' : ''}` : ''}
        ${sw('weekly', 'Sunday recap', 'Sunday at 7 pm: your workouts this week, and your crew\'s', P.weekly, !on)}</div>
      <p class="hint" style="text-align:left;margin:0">Messages and friend activity arrive even when Goliath is closed. Notifications are per phone, so turn them on on each device you use.</p>`;
  }
  async function show(){
    if (!AUTH.user) return;
    open = true; msg = null; back.hidden = false; document.documentElement.style.overflow = 'hidden';
    box.innerHTML = '<p class="hint">Loading…</p>'; await loadState(); paint();
    const x = box.querySelector('[data-nt="close"]'); if (x) x.focus();
  }
  function hide(){ open = false; back.hidden = true; document.documentElement.style.overflow = ''; if (S.tab === 'social') render(); }
  back.addEventListener('click', async e => {
    if (e.target === back) return hide();
    const b = e.target.closest('[data-nt],[data-ntday]'); if (!b) return;
    const a = b.dataset.nt;
    if (a === 'close') return hide();
    if (a === 'on') return turnOn();
    if (a === 'off') return turnOff();
    if (a === 'test') return test();
    if (b.dataset.ntday != null){
      const d = +b.dataset.ntday, days = cur().remind_days || [];
      await savePrefs({remind_days: days.includes(d) ? days.filter(x => x !== d) : days.concat(d).sort()}); return paint();
    }
    if (a){ const now = cur()[a], patch = {[a]: !now}; if (a === 'reminders' && !now && !(cur().remind_days || []).length) patch.remind_days = [1, 3, 5]; await savePrefs(patch); paint(); }
  });
  back.addEventListener('change', async e => { if (e.target.id === 'ntTime' && e.target.value){ await savePrefs({remind_time: e.target.value}); toast('Reminders at ' + e.target.value); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) hide(); });

  // entry points: the account menu and the Social tab
  window.addEventListener('goliath:notif', show);
  window.addEventListener('goliath:socialpaint', () => {
    if (S.tab !== 'social' || !AUTH.user) return;
    const set = document.querySelector('#socSet');
    if (set && !set.querySelector('[data-ntopen]')) set.insertAdjacentHTML('beforeend', `<button class="btn ghost" data-ntopen="1">Notification settings</button>`);
    const soc = document.querySelector('#tabSocial .soc:not(.chat)');
    let dismissed = false; try { dismissed = localStorage.getItem('goliath-nt-nudge') === '1'; } catch(e){}
    if (soc && supported && perm() === 'default' && !dismissed && !soc.querySelector('.nt-nudge')){
      const head = soc.querySelector('.soc-head');
      head && head.insertAdjacentHTML('afterend', `<div class="panel nt-nudge"><p>Get a heads-up when friends message you or send a request.</p><button class="btn" data-ntopen="1">Turn on</button><button class="chip sm" data-ntnudge="x" aria-label="Not now">Not now</button></div>`);
    }
  });
  document.addEventListener('click', e => {
    if (e.target.closest('[data-ntopen]')) return show();
    if (e.target.closest('[data-ntnudge]')){ try { localStorage.setItem('goliath-nt-nudge', '1'); } catch(err){} const n = document.querySelector('.nt-nudge'); n && n.remove(); }
  });

  // deep links from a tapped notification: ?go=social | gym | chat&u=<friend>
  function go(url){
    let u; try { u = new URL(url, location.href); } catch(e){ return; }
    const g = u.searchParams.get('go'); if (!g) return;
    if (g === 'chat' && window.__goliathSocial && u.searchParams.get('u')) window.__goliathSocial.openChat(u.searchParams.get('u'));
    else if (g === 'social' || g === 'gym' || g === 'chat'){ S.tab = g === 'gym' ? 'gym' : 'social'; render(); window.scrollTo(0, 0); }
    if (location.search.includes('go=')) history.replaceState(null, '', location.pathname);
  }
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.goliath === 'go') go(e.data.url); });
  const pending = location.search.includes('go=') ? location.href : null;
  window.addEventListener('goliath:signin', () => {
    if (pending) setTimeout(() => go(pending), 300);
    // keep the server copy of this phone's subscription fresh (browsers rotate them)
    if (supported && perm() === 'granted') reg().then(r => r && r.pushManager.getSubscription()).then(s => { if (!s) return; const j = s.toJSON(); sb().rpc('goliath_save_push_sub', {p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: navigator.userAgent}); }).catch(() => {});
  });
  window.addEventListener('goliath:signout', async () => {
    hide();
    // a signed-out phone shouldn't keep getting someone's messages
    try { const r = await reg(); const s = r && await r.pushManager.getSubscription(); if (s) await s.unsubscribe(); } catch(e){}
  });
})();
