// goliath-push: turns app events into web push notifications.
// Called by database triggers (friend requests, messages, programs, workouts), by a 15-minute cron
// tick (training reminders, Sunday recap), and by a signed-in user asking for a test notification.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
let cfg: Record<string, string> | null = null;
async function config() {
  if (cfg) return cfg;
  const { data, error } = await db.rpc("goliath_push_config");
  if (error || !data) throw new Error("push config unavailable");
  cfg = data as Record<string, string>;
  webpush.setVapidDetails("mailto:noreply@goliath-fit.vercel.app", cfg.goliath_vapid_public, cfg.goliath_vapid_private);
  return cfg;
}

const DEF = { messages: true, requests: true, programs: true, friend_workouts: true, reminders: false, remind_days: [], remind_time: "18:00:00", weekly: true, tz: "America/New_York" };
async function prefsOf(uid: string) {
  const { data } = await db.from("goliath_notify_prefs").select("*").eq("user_id", uid).maybeSingle();
  return { ...DEF, ...(data || {}) };
}
async function nameOf(uid: string) {
  const { data } = await db.from("goliath_profiles").select("name, email").eq("user_id", uid).maybeSingle();
  return (data && (data.name || (data.email || "").split("@")[0])) || "A friend";
}
const first = (n: string) => n.split(" ")[0];

type Note = { title: string; body: string; url: string; tag: string };
async function send(uid: string, n: Note) {
  await config();
  const { data: subs } = await db.from("goliath_push_subs").select("*").eq("user_id", uid);
  let sent = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(n), { TTL: 6 * 3600, urgency: "normal" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("goliath_push_subs").delete().eq("id", s.id);   // phone unsubscribed or app removed
      else console.error("push failed", code, String(e).slice(0, 200));
    }
  }
  return sent;
}

const RATE: Record<number, string> = { 1: "Way too hard", 2: "Hard", 3: "Solid", 4: "Good", 5: "Too easy" };
async function friendsOf(uid: string) {
  const { data } = await db.from("goliath_friends").select("requester, addressee").eq("status", "accepted").or(`requester.eq.${uid},addressee.eq.${uid}`);
  return (data || []).map((f) => (f.requester === uid ? f.addressee : f.requester)).filter(Boolean) as string[];
}
// local date parts in someone's time zone
function local(tz: string, d = new Date()) {
  let parts: Intl.DateTimeFormatPart[];
  try { parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d); }
  catch { return local("America/New_York", d); }
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return { dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday")), date: `${g("year")}-${g("month")}-${g("day")}`, mins: +g("hour") * 60 + +g("minute") };
}

async function handle(kind: string, r: Record<string, any>) {
  if (kind === "request") {
    const { data: p } = await db.from("goliath_profiles").select("user_id").eq("email", String(r.addressee_email).toLowerCase()).maybeSingle();
    const to = r.addressee || (p && p.user_id);
    if (!to || !(await prefsOf(to)).requests) return 0;
    return send(to, { title: "New friend request", body: `${r.requester_name || r.requester_email} wants to share workouts with you on Goliath.`, url: "./?go=social", tag: "req-" + r.id });
  }
  if (kind === "accepted") {
    if (!(await prefsOf(r.requester)).requests) return 0;
    const n = await nameOf(r.addressee);
    return send(r.requester, { title: `${first(n)} accepted your request`, body: "You can now see each other's workouts and send messages.", url: "./?go=social", tag: "acc-" + r.id });
  }
  if (kind === "message") {
    if (!(await prefsOf(r.recipient)).messages) return 0;
    const n = await nameOf(r.sender);
    return send(r.recipient, { title: n, body: String(r.body).slice(0, 140), url: `./?go=chat&u=${r.sender}`, tag: "chat-" + r.sender });
  }
  if (kind === "program") {
    if (!(await prefsOf(r.recipient)).programs) return 0;
    return send(r.recipient, { title: `${first(r.sender_name || "A friend")} sent you a program`, body: `${r.name}${r.note ? ": " + String(r.note).slice(0, 100) : ". Tap to add it to your builds."}`, url: "./?go=social", tag: "prog-" + r.id });
  }
  if (kind === "workout") {
    const { data: me } = await db.from("goliath_profiles").select("name, email, share").eq("user_id", r.user_id).maybeSingle();
    if (me && me.share === false) return 0;
    const n = first((me && (me.name || me.email.split("@")[0])) || "A friend");
    const hl = Array.isArray(r.highlights) && r.highlights[0] ? `Top set: ${r.highlights[0].n} ${r.highlights[0].w}${r.unit === "kg" ? " kg" : ""} × ${r.highlights[0].r}. ` : "";
    let sent = 0;
    for (const f of await friendsOf(r.user_id)) {
      if (!(await prefsOf(f)).friend_workouts) continue;
      sent += await send(f, { title: `${n} finished ${r.day_name}`, body: `${hl}${r.rating ? "Felt: " + RATE[r.rating] + ". " : ""}Send a cheer?`, url: "./?go=social", tag: "wk-" + r.id });
    }
    return sent;
  }
  if (kind === "tick") {
    const { data: rows } = await db.from("goliath_notify_prefs").select("*").or("reminders.eq.true,weekly.eq.true");
    let sent = 0;
    for (const p of rows || []) {
      const L = local(p.tz);
      const [hh, mm] = String(p.remind_time).split(":").map(Number);
      const at = hh * 60 + mm;
      if (p.reminders && (p.remind_days || []).includes(L.dow) && L.mins >= at && L.mins < at + 15 && p.last_reminded !== L.date) {
        await db.from("goliath_notify_prefs").update({ last_reminded: L.date }).eq("user_id", p.user_id);
        const { count } = await db.from("goliath_workouts").select("id", { count: "exact", head: true }).eq("user_id", p.user_id).gte("done_at", new Date(Date.now() - 14 * 3600e3).toISOString());
        if (!count) sent += await send(p.user_id, { title: "Time to train", body: "Your next workout is ready in the Gym tab. Even a short session keeps the streak going.", url: "./?go=gym", tag: "remind" });
      }
      if (p.weekly && L.dow === 0 && L.mins >= 19 * 60 && L.mins < 19 * 60 + 15 && p.last_weekly !== L.date) {
        await db.from("goliath_notify_prefs").update({ last_weekly: L.date }).eq("user_id", p.user_id);
        const since = new Date(Date.now() - 7 * 864e5).toISOString();
        const { count: mine } = await db.from("goliath_workouts").select("id", { count: "exact", head: true }).eq("user_id", p.user_id).gte("done_at", since);
        let best = "";
        for (const f of await friendsOf(p.user_id)) {
          const { count } = await db.from("goliath_workouts").select("id", { count: "exact", head: true }).eq("user_id", f).gte("done_at", since);
          if (count) best += `${best ? ", " : ""}${first(await nameOf(f))} ${count}`;
        }
        sent += await send(p.user_id, { title: "Your week in Goliath", body: `You finished ${mine || 0} workout${mine === 1 ? "" : "s"} this week.${best ? " Your crew: " + best + "." : ""} Plan next week's sessions?`, url: "./?go=gym", tag: "weekly" });
      }
    }
    return sent;
  }
  return 0;
}

Deno.serve(async (req) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const c = await config();
    // database triggers and the cron tick carry the shared secret
    if (req.headers.get("x-goliath-hook") === c.goliath_hook_secret) {
      const sent = await handle(String(body.kind), body.record || {});
      return Response.json({ ok: true, sent });
    }
    // a signed-in person can only ask for a test notification to their own devices
    const token = (req.headers.get("authorization") || "").replace(/^Bearer /i, "");
    const { data: u } = token ? await db.auth.getUser(token) : { data: { user: null } };
    if (!u || !u.user) return new Response("unauthorized", { status: 401, headers: cors });
    if (body.kind !== "test") return new Response("bad request", { status: 400, headers: cors });
    const sent = await send(u.user.id, { title: "Notifications are on", body: "This is how Goliath will reach you: messages, friend requests, programs and reminders.", url: "./?go=social", tag: "test" });
    return Response.json({ ok: true, sent }, { headers: cors });
  } catch (e) {
    console.error(e);
    return new Response("error", { status: 500, headers: cors });
  }
});
