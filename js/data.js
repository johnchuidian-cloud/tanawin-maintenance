// Tanawin Maintenance — state and every Supabase call.
//
// Rules honoured here (spec §8, global CLAUDE.md):
//   * explicit column lists, never select('*');
//   * open issues are the only list loaded whole — they are bounded by reality;
//     the archive is read a month at a time, paged in 200s on a unique order;
//   * counts come from the loaded open set (small) or from SQL, never from a
//     truncated page's length;
//   * an UPDATE that RLS silently refuses returns zero rows and no error
//     (Menu's lesson) — every update selects back and treats empty as failure.
'use strict';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const S = {
  me: null,             // {id, slug, name, role}
  settings: { hide_prices_from_staff: false, stale_after_days: 4 },
  staff: [],            // every row, active and not
  groups: [],
  areas: [],            // incl. archived (needed to name old issues)
  issues: [],           // open + fixed within RECENT_DAYS, items embedded
  equipment: [],        // not archived
  schedules: [],        // not archived, items embedded
  alerts: [],           // my feed, newest 100
  catalog: [],          // remembered item names (suggestions only)
  // ui
  page: 'issues', triage: 0, expOpen: false, search: '',
  eqFilter: 'All', scoreFilter: 'unseen', shopArea: '', viewMode: 'urgency',
  archive: { months: null, month: null, rows: [], area: '', cat: '', loading: false },
  signed: new Map(),    // storage path -> {url, until}
  loadedAt: 0,
};

const ISSUE_COLS = 'id, area_id, equipment_id, title, description, category, priority, ' +
  'reported_by_name, reported_by_id, reported_at, acknowledged_by_name, acknowledged_at, ' +
  'assigned_to_name, assigned_to_id, started_at, started_by_name, completed_at, completed_by_name, ' +
  'resolution_note, vendor_contact, reopened_count, last_reopened_at, photo_count, updated_at';
// No price columns are ever read: money lives in Finance (decision 2026-09-16).
const ITEM_COLS = 'id, issue_id, schedule_id, name, qty, unit, note, acquired, acquired_at, acquired_by_name, created_by_name';
const EQUIP_COLS = 'id, name, category, area_id, condition, qty, unit, low_stock_threshold, service_interval_months, ' +
  'last_serviced_at, purchase_date, warranty_expires, photo_path, note, archived_at, created_at';
const SCHED_COLS = 'id, area_id, equipment_id, task, interval_months, next_due_at, last_completed_at, note, created_by_name, archived_at';
const ALERT_COLS = 'id, audience, kind, actor_name, actor_id, text, subtext, issue_id, schedule_id, read_by, created_at';

function must({ data, error }, what) {
  if (error) throw new Error(what ? what + ': ' + error.message : error.message);
  return data;
}
function mustRow(res, what) {
  const data = must(res, what);
  if (!data || (Array.isArray(data) && !data.length)) throw new Error((what || 'Save') + ' did not go through. Check you are still signed in.');
  return Array.isArray(data) ? data[0] : data;
}

// ---- auth ------------------------------------------------------------------
async function loadRoster() {
  return must(await db.rpc('login_roster'), 'Could not load the login list');
}

async function signIn(slug, pin) {
  return db.auth.signInWithPassword({
    email: `${slug}@${AUTH_EMAIL_DOMAIN}`,
    password: `${AUTH_PASSWORD_PREFIX}${pin}`,
  });
}

// The staff TABLE says who I am. If my row is missing or inactive, the
// session is worthless: every table returns nothing.
async function loadMe(user) {
  const { data } = await db.from('staff').select('id, slug, name, role, is_active')
    .eq('auth_uid', user.id).maybeSingle();
  return data && data.is_active ? data : null;
}

// ---- bulk load -------------------------------------------------------------
async function loadAll() {
  const since = new Date(Date.now() - RECENT_DAYS * DAY).toISOString();
  // schedule-due alerts are raised by whoever loads first; idempotent
  db.rpc('sync_due_alerts').then(() => {}, () => {});
  const [settings, staff, groups, areas, issues, equipment, schedules, alerts, catalog] = await Promise.all([
    db.from('settings').select('hide_prices_from_staff, stale_after_days').eq('id', 1).maybeSingle(),
    db.from('staff').select('id, slug, name, role, is_active, sort_order, created_at, deactivated_at').order('sort_order'),
    db.from('area_groups').select('id, name, blocks_booking, sort').order('sort'),
    db.from('areas').select('id, group_id, name, sort, archived_at').order('sort'),
    db.from('issues').select(ISSUE_COLS + ', items(' + ITEM_COLS + ')')
      .or(`completed_at.is.null,completed_at.gte.${since}`)
      .order('reported_at', { ascending: false }).limit(1000),
    db.from('equipment').select(EQUIP_COLS).is('archived_at', null).order('name').limit(1000),
    db.from('schedules').select(SCHED_COLS + ', items(' + ITEM_COLS + ')').is('archived_at', null).order('next_due_at').limit(1000),
    db.from('alerts').select(ALERT_COLS).order('created_at', { ascending: false }).limit(100),
    db.from('item_catalog').select('id, name, name_key, times_bought').order('updated_at', { ascending: false }).limit(500),
  ]);
  S.settings = must(settings, 'settings') || S.settings;
  S.staff = must(staff, 'staff') || [];
  S.groups = must(groups, 'areas') || [];
  S.areas = must(areas, 'areas') || [];
  // areas ordered by group first, then their own sort, so "the first area" in
  // any picker is Ambon Ambon rather than whichever group happens to sort first
  const gsort = new Map(S.groups.map((g) => [g.id, g.sort]));
  S.areas.sort((a, b) => ((gsort.get(a.group_id) || 99) - (gsort.get(b.group_id) || 99)) || (a.sort - b.sort) || a.name.localeCompare(b.name));
  S.issues = must(issues, 'work orders') || [];
  S.equipment = must(equipment, 'equipment') || [];
  S.schedules = must(schedules, 'schedules') || [];
  S.alerts = must(alerts, 'alerts') || [];
  S.catalog = must(catalog, 'catalog') || [];
  S.archive.months = null;   // counts may have moved; the tab reloads them on next view
  S.loadedAt = Date.now();
}

async function reloadAlerts() {
  S.alerts = must(await db.from('alerts').select(ALERT_COLS).order('created_at', { ascending: false }).limit(100)) || [];
}

// ---- lookups & derivations ----------------------------------------------
const areaById = (id) => S.areas.find((a) => a.id === id) || null;
const areaName = (id) => (areaById(id) || {}).name || 'Unknown area';
const groupById = (id) => S.groups.find((g) => g.id === id) || null;
const groupOfArea = (areaId) => groupById((areaById(areaId) || {}).group_id) || { name: 'Other', blocks_booking: false };
const activeAreas = () => S.areas.filter((a) => !a.archived_at);
const activeStaff = () => S.staff.filter((s) => s.is_active);
const isManager = () => S.me && (S.me.role === 'owner' || S.me.role === 'admin');
const isOwner = () => S.me && S.me.role === 'owner';

const findIssue = (id) => S.issues.find((i) => i.id === id) || S.archive.rows.find((i) => i.id === id) || null;
const findEquip = (id) => S.equipment.find((e) => e.id === id) || null;
const findSched = (id) => S.schedules.find((s) => s.id === id) || null;
const findItem = (id) => {
  for (const i of S.issues) for (const it of i.items || []) if (it.id === id) return it;
  for (const s of S.schedules) for (const it of s.items || []) if (it.id === id) return it;
  return null;
};

function stage(i) { return i.completed_at ? 3 : (i.started_at ? 2 : 1); }
const isOpen = (i) => !i.completed_at;
const isUnseen = (i) => isOpen(i) && !i.acknowledged_at;
function isStalled(i) {
  return isOpen(i) && !!i.acknowledged_at && !i.started_at && daysOld(i.reported_at) >= (S.settings.stale_after_days || 4);
}
const needsAttention = (i) => isOpen(i) && !isUnseen(i) && (i.priority === 'urgent' || isStalled(i));
const openIssues = () => S.issues.filter(isOpen);
const unseenIssues = () => S.issues.filter(isUnseen);
const fixedRecently = () => S.issues.filter((i) => !!i.completed_at);
const unacquired = (i) => (i.items || []).filter((it) => !it.acquired);

// One unclaimed thing at a time: unassigned, or assigned to me but not yet
// acknowledged (Lexi assigned it; I have not looked). Unseen first, then
// urgent, then oldest.
function triageQueue() {
  const rank = { urgent: 0, soon: 1, routine: 2 };
  return openIssues()
    .filter((i) => !i.assigned_to_name || (i.assigned_to_id === S.me.id && !i.acknowledged_at))
    .sort((a, b) => (isUnseen(b) - isUnseen(a)) || (rank[a.priority] - rank[b.priority]) ||
      (new Date(a.reported_at) - new Date(b.reported_at)));
}

const isLow = (e) => e.category === 'Consumables' && e.low_stock_threshold != null && Number(e.qty) <= Number(e.low_stock_threshold);
function schedOfEquip(id) { return S.schedules.find((s) => s.equipment_id === id) || null; }
function openIssueOfEquip(id) { return openIssues().find((i) => i.equipment_id === id) || null; }
// "service due" is derived when the generated schedule is due, so the
// stored condition never has to be poked by a timer.
function equipCondition(e) {
  if (e.condition === 'broken') return 'broken';
  const s = schedOfEquip(e.id);
  if (s && s.next_due_at <= todayStr()) return 'service due';
  return e.condition;
}

const isDueSoon = (s) => s.next_due_at <= addDaysStr(todayStr(), 7);
const isOverdue = (s) => s.next_due_at < todayStr();

function catalogFor(name) {
  const k = nameKey(name);
  return S.catalog.find((c) => c.name_key === k) || null;
}

// The consolidated shopping list: every line from open work orders and
// live schedules plus low-stock consumables, grouped by name so "Light
// bulbs ×5" is one line with several sources.
function shoppingRows() {
  const groups = new Map();
  const push = (key, row) => {
    if (!groups.has(key)) groups.set(key, { key, name: row.name, unit: row.unit, qty: 0, ids: [], sources: [], est: null, actual: null,
      acquired: row.acquired, group: row.group, note: [], area_ids: new Set(), equip: row.equip || null, vendor: row.vendor || null });
    const g = groups.get(key);
    g.qty += Number(row.qty || 0);
    if (row.id) g.ids.push(row.id);
    g.sources.push(row.source);
    if (row.est != null) g.est = row.est;
    if (row.actual != null) g.actual = row.actual;
    if (row.note) g.note.push(row.note);
    if (row.area_id) g.area_ids.add(row.area_id);
    if (row.vendor) g.vendor = row.vendor;
  };
  for (const i of openIssues()) for (const it of i.items || []) {
    push('i:' + nameKey(it.name) + ':' + it.acquired, { id: it.id, name: it.name, unit: it.unit, qty: it.qty, acquired: it.acquired,
      est: null, actual: null, note: it.note, vendor: null, group: 'repairs',
      area_id: i.area_id, source: areaName(i.area_id) + ' — ' + i.title });
  }
  for (const s of S.schedules) for (const it of s.items || []) {
    push('s:' + nameKey(it.name) + ':' + it.acquired, { id: it.id, name: it.name, unit: it.unit, qty: it.qty, acquired: it.acquired,
      est: null, actual: null, note: it.note, vendor: null, group: 'sched',
      area_id: s.area_id, source: s.task + ' · ' + dueLabel(s.next_due_at) });
  }
  for (const e of S.equipment) if (isLow(e)) {
    push('e:' + e.id, { id: null, name: e.name, unit: e.unit, qty: 1, acquired: false, est: null,
      actual: null, note: e.note, vendor: null, group: 'low', area_id: e.area_id, equip: e,
      source: areaName(e.area_id) + ' — ' + e.qty + (e.unit ? ' ' + e.unit : '') + ' left' });
  }
  return [...groups.values()];
}
const shopOutstanding = () => shoppingRows().filter((r) => !r.acquired).length;

// ---- alerts ----------------------------------------------------------------
const alertUnread = (a) => !(a.read_by || []).includes(S.me.id);
const unreadCount = () => S.alerts.filter(alertUnread).length;
async function markAlertsRead(ids) {
  if (!ids.length) return;
  must(await db.rpc('mark_alerts_read', { p_ids: ids }));
  for (const a of S.alerts) if (ids.includes(a.id) && alertUnread(a)) a.read_by = [...(a.read_by || []), S.me.id];
}

// ---- issues ----------------------------------------------------------------
async function reportIssue(fields) {
  return mustRow(await db.from('issues').insert({
    area_id: fields.area_id, equipment_id: fields.equipment_id || null,
    title: fields.title, description: fields.description || null,
    category: fields.category, priority: fields.priority,
    reported_by_name: S.me.name, reported_by_id: S.me.id,
  }).select('id'), 'Posting the work order');
}

// An archived work order reached from an alert or a link: fetch just that one
// and park it with the archive rows so findIssue() resolves it.
async function loadIssueById(id) {
  const row = must(await db.from('issues').select(ISSUE_COLS + ', items(' + ITEM_COLS + ')').eq('id', id).maybeSingle(), 'Loading the work order');
  if (row && !findIssue(id)) S.archive.rows.push(row);
  return row;
}

async function updateIssue(id, patch) {
  return mustRow(await db.from('issues').update(patch).eq('id', id).select('id'), 'Saving the work order');
}

async function loadIssueDetail(id) {
  const [notes, events, photos] = await Promise.all([
    db.from('issue_notes').select('id, author_name, body, created_at').eq('issue_id', id).order('created_at'),
    db.from('issue_events').select('id, actor_name, kind, from_value, to_value, at').eq('issue_id', id).order('at'),
    db.from('issue_photos').select('id, path, kind, uploaded_by_name, uploaded_at').eq('issue_id', id).order('uploaded_at'),
  ]);
  const p = must(photos, 'photos') || [];
  await signPaths(p.map((x) => x.path));
  return { notes: must(notes, 'notes') || [], events: must(events, 'history') || [], photos: p };
}

async function addNote(issueId, body) {
  mustRow(await db.from('issue_notes').insert({ issue_id: issueId, author_name: S.me.name, author_id: S.me.id, body }).select('id'), 'Adding the note');
}

// ---- photos ----------------------------------------------------------------
async function signPaths(paths) {
  const need = paths.filter((p) => p && !(S.signed.get(p) && S.signed.get(p).until > Date.now()));
  if (!need.length) return;
  const { data, error } = await db.storage.from('photos').createSignedUrls(need, 3600);
  if (error) return;   // thumbnails simply stay blank; the row still shows
  for (const r of data || []) if (r.signedUrl && r.path) S.signed.set(r.path, { url: r.signedUrl, until: Date.now() + 50 * MIN });
}
const signedUrl = (path) => (S.signed.get(path) || {}).url || '';

// Compress, upload, record. Throws with a plain message on any failure so
// the caller can show it and offer Retry — a silently dropped photo is a
// silently dropped report (spec §5).
async function uploadPhoto(folder, file, onStatus) {
  onStatus && onStatus('Preparing photo…');
  const blob = await compressImage(file);
  const path = `${folder}/${uuid()}.jpg`;
  onStatus && onStatus('Uploading…');
  const { error } = await db.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error('Upload failed: ' + error.message);
  return { path, bytes: blob.size };
}

async function addIssuePhoto(issueId, file, kind, onStatus) {
  const { path, bytes } = await uploadPhoto('issues/' + issueId, file, onStatus);
  mustRow(await db.from('issue_photos').insert({ issue_id: issueId, path, kind, uploaded_by_name: S.me.name, uploaded_by_id: S.me.id, bytes }).select('id'), 'Saving the photo');
  return path;
}

// ---- items -----------------------------------------------------------------
async function addItem(fields) {
  return mustRow(await db.from('items').insert({
    issue_id: fields.issue_id || null, schedule_id: fields.schedule_id || null,
    name: fields.name, qty: fields.qty || 1, unit: fields.unit || null, note: fields.note || null,
    created_by_name: S.me.name, created_by_id: S.me.id,
  }).select('id'), 'Adding the item');
}
async function updateItem(id, patch) {
  return mustRow(await db.from('items').update(patch).eq('id', id).select('id'), 'Saving the item');
}
async function deleteItem(id) {
  mustRow(await db.from('items').delete().eq('id', id).select('id'), 'Removing the item');
}
// No prices are kept (decision 2026-09-16: all money lives in Finance). The RPC
// still accepts them; the app never sends any.
async function acquireItems(ids) {
  must(await db.rpc('acquire_items', { p_ids: ids, p_actual: null, p_vendor: null }), 'Marking as bought');
}
async function unacquireItems(ids) {
  must(await db.rpc('unacquire_items', { p_ids: ids }), 'Unticking');
}
async function restockEquipment(id, added) {
  must(await db.rpc('restock_equipment', { p_id: id, p_added: added, p_actual: null, p_vendor: null }), 'Restocking');
}

// ---- equipment -------------------------------------------------------------
async function setEquipmentState(id, patch) {
  must(await db.rpc('set_equipment_state', {
    p_id: id, p_condition: patch.condition ?? null, p_qty: patch.qty ?? null,
    p_note: patch.note ?? null, p_photo_path: patch.photo_path ?? null,
  }), 'Saving equipment');
}
async function saveEquipment(id, fields) {
  const row = {
    name: fields.name, category: fields.category, area_id: fields.area_id,
    qty: fields.qty, unit: fields.unit || null,
    low_stock_threshold: fields.low_stock_threshold ?? null,
    service_interval_months: fields.service_interval_months ?? null,
    last_serviced_at: fields.last_serviced_at || null,
    purchase_date: fields.purchase_date || null, warranty_expires: fields.warranty_expires || null,
    note: fields.note || null,
  };
  if (id) return mustRow(await db.from('equipment').update(row).eq('id', id).select('id'), 'Saving equipment');
  row.condition = fields.condition || 'working';
  row.created_by_name = S.me.name;
  return mustRow(await db.from('equipment').insert(row).select('id'), 'Adding equipment');
}
async function archiveEquipment(id, archived) {
  mustRow(await db.from('equipment').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', id).select('id'), 'Archiving');
}

// ---- schedules -------------------------------------------------------------
async function saveSchedule(id, fields) {
  const row = { area_id: fields.area_id, task: fields.task, interval_months: fields.interval_months, next_due_at: fields.next_due_at, note: fields.note || null };
  if (id) return mustRow(await db.from('schedules').update(row).eq('id', id).select('id'), 'Saving the schedule');
  row.created_by_name = S.me.name;
  return mustRow(await db.from('schedules').insert(row).select('id'), 'Adding the schedule');
}
async function archiveSchedule(id) {
  mustRow(await db.from('schedules').update({ archived_at: new Date().toISOString() }).eq('id', id).select('id'), 'Archiving');
}
async function completeSchedule(id, note) {
  must(await db.rpc('complete_schedule', { p_id: id, p_note: note || null }), 'Marking done');
}
async function loadCompletions(id) {
  return must(await db.from('schedule_completions').select('id, completed_by_name, completed_at, note')
    .eq('schedule_id', id).order('completed_at', { ascending: false }).limit(50)) || [];
}

// ---- areas / settings / staff ---------------------------------------------
async function saveArea(id, fields) {
  if (id) return mustRow(await db.from('areas').update({ name: fields.name, group_id: fields.group_id, archived_at: fields.archived_at ?? null }).eq('id', id).select('id'), 'Saving the area');
  const sort = S.areas.filter((a) => a.group_id === fields.group_id).length + 1;
  return mustRow(await db.from('areas').insert({ name: fields.name, group_id: fields.group_id, sort }).select('id'), 'Adding the area');
}
async function saveSettings(patch) {
  mustRow(await db.from('settings').update(patch).eq('id', 1).select('id'), 'Saving settings');
}

// Staff writes go through the Edge Function (service role lives there).
async function manageStaff(body) {
  const { data: { session } } = await db.auth.getSession();
  if (!session) throw new Error('Please sign in again.');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-staff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  let out = {};
  try { out = await res.json(); } catch { /* non-JSON error */ }
  if (!res.ok || out.error) throw new Error(out.error || `Staff change failed (${res.status})`);
  return out;
}

// ---- archive ---------------------------------------------------------------
async function loadMonths() {
  S.archive.months = must(await db.rpc('issues_months'), 'Loading the archive') || [];
}
// Paged on (completed_at, id) — a unique order, so nothing straddles a page.
async function loadMonth(ym) {
  const { start, end } = monthRange(ym);
  const rows = [];
  let from = 0;
  const PAGE = 200;
  for (;;) {
    const page = must(await db.from('issues').select(ISSUE_COLS + ', items(' + ITEM_COLS + ')')
      .gte('completed_at', start).lt('completed_at', end)
      .order('completed_at', { ascending: false }).order('id')
      .range(from, from + PAGE - 1), 'Loading the month') || [];
    rows.push(...page);
    if (page.length < PAGE) break;
    from += PAGE;
  }
  S.archive.month = ym;
  S.archive.rows = rows;
}
