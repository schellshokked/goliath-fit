// Goliath accounts: email + password sign-in through Supabase, one private data row per person.
// Loaded after the app script, so it can read and replace the app's top-level state (A, SAVED, LOG, ...).
// With no keys in config.js the app runs exactly as before, with data kept on this device only.
(function(){
  const CFG = window.GOLIATH_SUPABASE || {};
  if (!CFG.url || !CFG.anonKey) return;               // accounts not switched on yet
  const LOCAL_KEYS = [KEY, 'ra-saved', 'ra-profile', 'ra-checks', 'ra-subs'];
  const OWNER = 'gol-owner', DIRTY = 'gol-unsynced';
  const TABLE = 'goliath_data';
  let sb = null, user = null, syncState = 'idle', pending = null, lastPull = 0, offerMigrate = false;

  // ---------- local state helpers ----------
  const snapshot = () => JSON.parse(JSON.stringify({A, SAVED, LOG, NEXT, STR, HIST, REV}));
  const hasLocalData = () => !!(A.done || (A.builds && A.builds.length) || (A.custom && A.custom.days && A.custom.days.length) || SAVED.length || Object.keys(LOG).length || HIST.length);
  function writeLocal(){ _save(); _lset('ra-saved', SAVED); _lset('ra-profile', profData()); }
  function clearLocal(){
    LOCAL_KEYS.concat(DIRTY).forEach(k => { try { localStorage.removeItem(k); } catch(e){} });
    A = defaults(); SAVED = []; LOG = {}; NEXT = 0; STR = {ex:{}, lift:{}}; HIST = []; REV = 0;
    CHECKS.clear(); SUBS = {date: today(), map: {}};
  }
  function hydrate(d){
    A = Object.assign(defaults(), d.A || {}); SAVED = Array.isArray(d.SAVED) ? d.SAVED : [];
    LOG = d.LOG || {}; NEXT = +d.NEXT || 0; STR = d.STR || {ex:{}, lift:{}}; HIST = Array.isArray(d.HIST) ? d.HIST : []; REV = +d.REV || 0;
    writeLocal(); resetView();
  }
  function resetView(){
    builds(); rebuild();
    Object.assign(S, {quiz:false, step:0, day:0, gymDay:null, review:null, bId:null, bPick:false, saving:false, swapKey:null});
    render();
  }

  // ---------- every local save also queues a sync ----------
  const _save = save, _lset = lset;
  save = function(){ _save(); queueSync(); };
  lset = function(k, v){ _lset(k, v); if (k === 'ra-saved' || k === 'ra-profile') queueSync(); };
  function queueSync(){
    if (!user) return;
    try { localStorage.setItem(DIRTY, String(Date.now())); } catch(e){}
    clearTimeout(pending); syncState = 'saving'; paintStatus();
    pending = setTimeout(pushNow, 1200);
  }
  async function pushNow(){
    clearTimeout(pending); pending = null;
    if (!user) return;
    if (!navigator.onLine){ syncState = 'offline'; paintStatus(); return; }
    const {error} = await sb.from(TABLE).upsert({user_id: user.id, data: snapshot(), updated_at: new Date().toISOString()});
    syncState = error ? 'error' : 'saved'; if (!error){ lastPull = Date.now(); try { localStorage.removeItem(DIRTY); } catch(e){} }
    paintStatus();
  }
  async function pull(){
    const {data, error} = await sb.from(TABLE).select('data, updated_at').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return data;
  }
  // coming back to the app (or back online) picks up changes made on another device
  async function refresh(){
    if (!user || pending || !navigator.onLine) return;
    try {
      const row = await pull();
      if (row && Date.parse(row.updated_at) > lastPull + 1000){ lastPull = Date.parse(row.updated_at); hydrate(row.data); }
    } catch(e){}
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); else if (pending) pushNow(); });
  window.addEventListener('online', () => { if (syncState === 'offline' || syncState === 'error') pushNow(); else refresh(); });

  // ---------- signing in ----------
  async function onSignedIn(u){
    user = u; hideGate();
    const owner = localStorage.getItem(OWNER);
    if (owner && owner !== u.id) clearLocal();          // someone else used this phone: never mix their data in
    let row = null;
    try { row = await pull(); } catch(e){ syncState = 'offline'; }
    const unsynced = owner === u.id && localStorage.getItem(DIRTY);
    if (unsynced){ resetView(); pushNow(); }            // changes made offline on this phone are newer than the account copy
    else if (row){ lastPull = Date.parse(row.updated_at); hydrate(row.data); }
    else if (!owner && hasLocalData()){ offerMigrate = true; resetView(); }
    else if (owner === u.id && hasLocalData()){ pushNow(); }
    else { clearLocal(); writeLocal(); resetView(); }
    localStorage.setItem(OWNER, u.id);
    paintStatus();
  }
  async function signOut(){
    if (pending) await pushNow();
    await sb.auth.signOut();
    user = null; clearLocal(); localStorage.removeItem(OWNER); resetView(); showGate('in');
  }

  // ---------- sign-in screen ----------
  const css = document.createElement('style');
  css.textContent = `
  .gate{position:fixed;inset:0;z-index:50;background:var(--bg);overflow:auto;padding:calc(24px + env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) calc(24px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px))}
  .gate-in{max-width:400px;margin:0 auto;display:grid;gap:16px}
  .gate-brand{display:grid;justify-items:center;gap:12px;padding:12px 0 4px}
  .gate-brand img{width:96px;height:96px;border-radius:22px}
  .gate-brand .mark{font-size:30px}
  .gate .seg{justify-self:center}
  .gate form{display:grid;gap:12px}
  .gate .msg{font-size:14px;padding:10px 12px;border-radius:10px;background:var(--surface-2);color:var(--ink)}
  .gate .msg.err{background:var(--red-soft);color:var(--red)}
  .gate .msg.ok{background:var(--green-soft);color:var(--green)}
  .gate .link{background:none;border:0;color:var(--accent);font-weight:650;font-size:14px;padding:4px;justify-self:center}
  .acct{display:grid;gap:8px;margin-bottom:14px}
  .acct .who{display:flex;align-items:center;gap:10px;min-width:0}
  .acct .av{width:36px;height:36px;border-radius:50%;background:var(--ink);color:var(--bg);display:grid;place-items:center;font:700 15px var(--f-body);flex:none}
  .acct .who b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .acct .who small{color:var(--muted);font-size:12.5px}
  .acct .row{flex-wrap:wrap}
  .acct .row .chip{flex:none}
  .mig{border:1.5px solid var(--accent);background:var(--accent-soft)}`;
  document.head.appendChild(css);
  const gate = document.createElement('div');
  gate.className = 'gate'; gate.hidden = true; gate.setAttribute('role', 'dialog'); gate.setAttribute('aria-label', 'Sign in to Goliath');
  document.body.appendChild(gate);
  let mode = 'in', note = null;
  function showGate(m, n){ mode = m || mode; note = n || null; paintGate(); gate.hidden = false; document.body.style.overflow = 'hidden'; }
  function hideGate(){ gate.hidden = true; document.body.style.overflow = ''; }
  function paintGate(){
    const logo = (document.querySelector('.mark .logo') || {}).src || '';
    const titles = {in:'Sign in', up:'Create your account', reset:'Reset your password', newpw:'Choose a new password'};
    gate.innerHTML = `<div class="gate-in">
      <div class="gate-brand">${logo ? `<img src="${logo}" alt="Goliath Strength Trainer logo">` : ''}<div class="mark"><span>Goliath<small>Strength Trainer</small></span></div></div>
      ${mode === 'in' || mode === 'up' ? `<div class="seg" role="tablist"><button type="button" data-gm="in" class="${mode === 'in' ? 'on' : ''}">Sign in</button><button type="button" data-gm="up" class="${mode === 'up' ? 'on' : ''}">Create account</button></div>` : `<h2 class="display" style="font-size:30px;text-align:center">${titles[mode]}</h2>`}
      ${note ? `<div class="msg ${note.k || ''}" role="status">${esc(note.t)}</div>` : ''}
      <form id="gateForm" novalidate>
        ${mode === 'up' ? `<div class="field"><label for="gName">First name</label><input id="gName" autocomplete="given-name" maxlength="40"></div>` : ''}
        ${mode !== 'newpw' ? `<div class="field"><label for="gEmail">Email</label><input id="gEmail" type="email" autocomplete="email" inputmode="email" required></div>` : ''}
        ${mode !== 'reset' ? `<div class="field"><label for="gPass">${mode === 'newpw' ? 'New password' : 'Password'}</label><input id="gPass" type="password" autocomplete="${mode === 'in' ? 'current-password' : 'new-password'}" minlength="8" required>${mode !== 'in' ? '<span class="hint" style="text-align:left">At least 8 characters.</span>' : ''}</div>` : ''}
        <button class="btn" id="gGo" type="submit">${{in:'Sign in', up:'Create account', reset:'Send reset link', newpw:'Save new password'}[mode]}</button>
      </form>
      ${mode === 'in' ? '<button class="link" type="button" data-gm="reset">Forgot your password?</button>' : ''}
      ${mode === 'reset' ? '<button class="link" type="button" data-gm="in">Back to sign in</button>' : ''}
      <p class="hint">Your plans, builds and lifts are private to your account and follow you to any device.</p>
    </div>`;
  }
  gate.addEventListener('click', e => { const b = e.target.closest('[data-gm]'); if (b){ mode = b.dataset.gm; note = null; paintGate(); } });
  gate.addEventListener('submit', async e => {
    e.preventDefault();
    const email = ((gate.querySelector('#gEmail') || {}).value || '').trim();
    const pass = (gate.querySelector('#gPass') || {}).value || '';
    const name = ((gate.querySelector('#gName') || {}).value || '').trim();
    const go = gate.querySelector('#gGo');
    const fail = t => { note = {k:'err', t}; paintGate(); const f = gate.querySelector('#gEmail'); if (f) f.value = email; };
    if (mode !== 'newpw' && !/^\S+@\S+\.\S+$/.test(email)) return fail('Enter a valid email address.');
    if (mode !== 'reset' && pass.length < 8) return fail('Passwords need at least 8 characters.');
    if (!navigator.onLine) return fail('You are offline. Connect to the internet to sign in.');
    go.disabled = true; go.textContent = 'One moment…';
    try {
      if (mode === 'in'){
        const {data, error} = await sb.auth.signInWithPassword({email, password: pass});
        if (error) return fail(/confirm/i.test(error.message) ? 'Confirm your email first: open the link we sent you, then sign in.' : 'That email and password do not match. Try again or reset your password.');
        await onSignedIn(data.user);
      } else if (mode === 'up'){
        const {data, error} = await sb.auth.signUp({email, password: pass, options: {data: {name}, emailRedirectTo: location.origin + location.pathname}});
        if (error) return fail(/registered|exists/i.test(error.message) ? 'There is already an account with that email. Sign in instead.' : error.message);
        if (data.session) await onSignedIn(data.user);
        else { mode = 'in'; note = {k:'ok', t:'Account created. Check your email and tap the confirmation link, then sign in.'}; paintGate(); }
      } else if (mode === 'reset'){
        const {error} = await sb.auth.resetPasswordForEmail(email, {redirectTo: location.origin + location.pathname});
        if (error) return fail(error.message);
        mode = 'in'; note = {k:'ok', t:'If that email has an account, a reset link is on its way. Open it on this device.'}; paintGate();
      } else if (mode === 'newpw'){
        const {data, error} = await sb.auth.updateUser({password: pass});
        if (error) return fail(error.message);
        history.replaceState(null, '', location.pathname);
        await onSignedIn(data.user); toast('Password updated');
      }
    } catch(err){ fail('Could not reach the sign-in service. Check your connection and try again.'); }
  });

  // ---------- account panel on the My program tab ----------
  const STATUS = {idle:'', saving:'Saving…', saved:'All changes saved to your account', offline:'Offline. Changes will sync when you reconnect.', error:'Could not sync just now. It will retry.'};
  function paintStatus(){ const el = document.getElementById('acctStatus'); if (el) el.textContent = STATUS[syncState] || ''; }
  const _renderPlan = renderPlan;
  renderPlan = function(){
    _renderPlan();
    if (!user || S.quiz) return;
    const nm = (user.user_metadata && user.user_metadata.name) || '';
    const el = document.getElementById('tabPlan');
    el.insertAdjacentHTML('afterbegin', `${offerMigrate ? `<div class="panel mig acct" role="alert"><b>Plans from before accounts are on this phone.</b><span style="font-size:14px">Add them to your account so they follow you to other devices?</span><div class="row"><button class="btn" data-acct="keep">Add to my account</button><button class="btn ghost" data-acct="fresh">Start fresh</button></div></div>` : ''}
      <div class="panel acct"><div class="who"><span class="av" aria-hidden="true">${esc((nm || user.email || '?')[0].toUpperCase())}</span><span style="min-width:0"><b>${esc(nm || user.email)}</b>${nm ? `<small style="display:block">${esc(user.email)}</small>` : ''}<small id="acctStatus" style="display:block">${STATUS[syncState] || ''}</small></span></div>
      <div class="row"><button class="chip sm" data-acct="pw">Change password</button><button class="chip sm" data-acct="out">Sign out</button></div></div>`);
  };
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-acct]'); if (!b) return;
    const a = b.dataset.acct;
    if (a === 'out') return signOut();
    if (a === 'pw'){ const {error} = await sb.auth.resetPasswordForEmail(user.email, {redirectTo: location.origin + location.pathname}); toast(error ? 'Could not send the email. Try again.' : 'Password reset link sent to ' + user.email); return; }
    if (a === 'keep'){ offerMigrate = false; await pushNow(); renderPlan(); toast('Your plans are now in your account'); return; }
    if (a === 'fresh'){ offerMigrate = false; clearLocal(); writeLocal(); await pushNow(); resetView(); toast('Started fresh'); return; }
  });
  // the logo opens your account
  document.addEventListener('click', e => { if (user && e.target.closest('.top .mark')){ S.tab = 'plan'; S.quiz = false; render(); window.scrollTo(0, 0); } });

  // ---------- start ----------
  if (!window.supabase || !window.supabase.createClient){
    // the sign-in library could not load (offline on a first visit): keep the last person's data, if any
    if (!localStorage.getItem(OWNER)) showGate('in', {k:'err', t:'Connect to the internet to sign in.'});
    return;
  }
  sb = window.supabase.createClient(CFG.url, CFG.anonKey, {auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true}});
  window.__goliathAuth = {get user(){ return user; }, pushNow, refresh};
  sb.auth.onAuthStateChange((ev, session) => { if (ev === 'PASSWORD_RECOVERY') showGate('newpw'); });
  sb.auth.getSession().then(({data}) => {
    if (/type=recovery/.test(location.hash)) return;      // the recovery event shows the new-password form
    if (data.session && data.session.user) onSignedIn(data.session.user);
    else showGate(/type=signup/.test(location.hash) ? 'in' : 'in', /type=signup/.test(location.hash) ? {k:'ok', t:'Email confirmed. Sign in to start.'} : null);
  });
})();
