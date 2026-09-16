// Tanawin Maintenance — staff management (owner + admins).
//
// Creating or changing a GoTrue login needs the service role, which must never
// reach a browser, so every staff write lives here. The caller proves who they
// are with their own session token; what they are ALLOWED to do is read from
// the `staff` TABLE — never from user_metadata, which a user can rewrite.
//
// Rules (spec §3, stronger than Menu's):
//   owner  – everything; the only role that can change a role; cannot be
//            demoted, deactivated or PIN-reset by anyone else.
//   admin  – add STAFF (not admins), rename/deactivate/reactivate/delete STAFF,
//            reset a STAFF PIN, change own PIN.
//   staff  – change own PIN only.
//
// Actions (POST JSON {action, ...}):
//   add        {name, role?, pin}      → {ok, id, slug, name, role}
//   set_role   {id, role}              owner only
//   set_pin    {id?, pin}              id omitted = yourself
//   rename     {id, name}
//   deactivate {id}                    also bans the login
//   reactivate {id}                    lifts the ban
//   delete     {id}                    removes login + row (history keeps the name)
//
// Deployed with --no-verify-jwt (Menu's pattern): this code verifies the
// caller itself, and a missing/invalid token is a 403 either way.

import { createClient } from 'npm:@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const EMAIL_DOMAIN = 'tanawin.maintenance';
const PASSWORD_PREFIX = 'tanawin-maintenance-v1:';   // public by design; the secret is the 4 digits
const BAN = '876000h';                                // ~100 years: "deactivated"

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const slugify = (name: string) =>
  name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const emailFor = (slug: string) => `${slug}@${EMAIL_DOMAIN}`;
const passwordFor = (pin: string) => `${PASSWORD_PREFIX}${pin}`;
const isPin = (pin: string) => /^\d{4}$/.test(pin);

type Row = { id: string; slug: string; name: string; role: string; is_active: boolean; auth_uid: string };
const COLS = 'id, slug, name, role, is_active, auth_uid';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // 1) Who is calling? Their own token, verified by GoTrue.
  const authHeader = req.headers.get('Authorization') ?? '';
  const asCaller = createClient(URL, ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authErr } = await asCaller.auth.getUser();
  if (authErr || !user) return json({ error: 'Please sign in again.' }, 403);

  // 2) What may they do? The staff TABLE decides.
  const admin = createClient(URL, SERVICE);
  const { data: me } = await admin.from('staff').select(COLS).eq('auth_uid', user.id).maybeSingle();
  if (!me || !me.is_active) return json({ error: 'Your account is not active.' }, 403);
  const caller = me as Row;
  const isOwner = caller.role === 'owner';
  const isManager = isOwner || caller.role === 'admin';

  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  const action = body.action;

  const target = async (id: string): Promise<Row | null> => {
    if (!id) return null;
    const { data } = await admin.from('staff').select(COLS).eq('id', id).maybeSingle();
    return (data as Row) ?? null;
  };

  try {
    if (action === 'add') {
      if (!isManager) return json({ error: 'Only the owner and admins can add people.' }, 403);
      const name = (body.name ?? '').trim();
      const role = body.role === 'admin' ? 'admin' : 'staff';
      const pin = (body.pin ?? '').trim();
      if (!name) return json({ error: 'A name is needed.' }, 400);
      if (name.length > 60) return json({ error: 'That name is too long.' }, 400);
      if (!isPin(pin)) return json({ error: 'The PIN must be exactly 4 digits.' }, 400);
      if (role === 'admin' && !isOwner) return json({ error: 'Only the owner can create an admin.' }, 403);

      let slug = slugify(name);
      if (!slug) return json({ error: 'Use letters or numbers in the name.' }, 400);
      const { data: existing } = await admin.from('staff').select('slug');
      const taken = new Set((existing ?? []).map((r: { slug: string }) => r.slug));
      if (taken.has(slug)) { let n = 2; while (taken.has(`${slug}-${n}`)) n++; slug = `${slug}-${n}`; }

      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email: emailFor(slug),
        password: passwordFor(pin),
        email_confirm: true,
        user_metadata: { name },        // display only; never a gate
      });
      if (cErr || !created?.user) return json({ error: cErr?.message ?? 'Could not create the login.' }, 400);

      const { data: maxRow } = await admin.from('staff')
        .select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle();
      const { data: row, error: iErr } = await admin.from('staff')
        .insert({ slug, name, role, auth_uid: created.user.id, sort_order: (maxRow?.sort_order ?? 0) + 1 })
        .select('id').single();
      if (iErr || !row) {
        await admin.auth.admin.deleteUser(created.user.id);   // never leave an orphan login
        return json({ error: iErr?.message ?? 'Could not save the person.' }, 400);
      }
      return json({ ok: true, id: row.id, slug, name, role });
    }

    if (action === 'set_role') {
      if (!isOwner) return json({ error: 'Only the owner can change roles.' }, 403);
      const role = body.role === 'admin' ? 'admin' : body.role === 'staff' ? 'staff' : null;
      if (!role) return json({ error: 'Role must be admin or staff.' }, 400);
      const t = await target(body.id);
      if (!t) return json({ error: 'That person no longer exists.' }, 404);
      if (t.role === 'owner') return json({ error: 'The owner’s role cannot be changed.' }, 403);
      if (t.role === role) return json({ ok: true, role });
      const { error } = await admin.from('staff').update({ role }).eq('id', t.id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, role });
    }

    if (action === 'set_pin') {
      const pin = (body.pin ?? '').trim();
      if (!isPin(pin)) return json({ error: 'The PIN must be exactly 4 digits.' }, 400);
      const t = body.id ? await target(body.id) : caller;
      if (!t) return json({ error: 'That person no longer exists.' }, 404);
      const isSelf = t.id === caller.id;
      if (!isSelf) {
        if (!isManager) return json({ error: 'You can only change your own PIN.' }, 403);
        if (t.role === 'owner') return json({ error: 'Only the owner can reset the owner’s PIN.' }, 403);
        if (t.role === 'admin' && !isOwner) return json({ error: 'Only the owner can reset an admin’s PIN.' }, 403);
      }
      const { error } = await admin.auth.admin.updateUserById(t.auth_uid, { password: passwordFor(pin) });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === 'rename') {
      const name = (body.name ?? '').trim();
      if (!name || name.length > 60) return json({ error: 'A name is needed.' }, 400);
      const t = await target(body.id);
      if (!t) return json({ error: 'That person no longer exists.' }, 404);
      const isSelf = t.id === caller.id;
      if (!isSelf) {
        if (!isManager) return json({ error: 'Not allowed.' }, 403);
        if (t.role !== 'staff' && !isOwner) return json({ error: 'Only the owner can rename an admin.' }, 403);
      }
      const { error } = await admin.from('staff').update({ name }).eq('id', t.id);
      if (error) return json({ error: error.message }, 400);
      await admin.auth.admin.updateUserById(t.auth_uid, { user_metadata: { name } });
      return json({ ok: true, name });
    }

    if (action === 'deactivate' || action === 'reactivate') {
      if (!isManager) return json({ error: 'Only the owner and admins can do that.' }, 403);
      const t = await target(body.id);
      if (!t) return json({ error: 'That person no longer exists.' }, 404);
      if (t.role === 'owner') return json({ error: 'The owner account cannot be deactivated.' }, 403);
      if (t.id === caller.id) return json({ error: 'You cannot deactivate yourself.' }, 400);
      if (t.role === 'admin' && !isOwner) return json({ error: 'Only the owner can deactivate an admin.' }, 403);
      const active = action === 'reactivate';
      // Ban first: if the table write then fails, a banned-but-active row is
      // the safer inconsistency (login blocked, data gates still apply).
      const { error: bErr } = await admin.auth.admin.updateUserById(t.auth_uid, { ban_duration: active ? 'none' : BAN });
      if (bErr) return json({ error: bErr.message }, 400);
      const { error } = await admin.from('staff')
        .update({ is_active: active, deactivated_at: active ? null : new Date().toISOString() })
        .eq('id', t.id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, is_active: active });
    }

    // Permanent removal — for people who should never have been on the list.
    // History is unaffected: every record carries the name as text, never a
    // link to this row. Same gates as deactivate.
    if (action === 'delete') {
      if (!isManager) return json({ error: 'Only the owner and admins can remove people.' }, 403);
      const t = await target(body.id);
      if (!t) return json({ error: 'That person no longer exists.' }, 404);
      if (t.role === 'owner') return json({ error: 'The owner account cannot be removed.' }, 403);
      if (t.id === caller.id) return json({ error: 'You cannot remove yourself.' }, 400);
      if (t.role === 'admin' && !isOwner) return json({ error: 'Only the owner can remove an admin.' }, 403);
      // login first, then the row: a row without a login is harmless, the
      // reverse would leave a working login with no permissions and no name
      const { error: dErr } = await admin.auth.admin.deleteUser(t.auth_uid);
      if (dErr && !/not found/i.test(dErr.message)) return json({ error: dErr.message }, 400);
      const { error } = await admin.from('staff').delete().eq('id', t.id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: 'Something went wrong.' }, 500);
  }
});
