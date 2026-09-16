// Tanawin Maintenance — boot, auth, rendering and every user action.
// One delegated click handler, like the prototype: elements carry data-*
// attributes, nothing binds its own listener.
'use strict';

// ---- render ----------------------------------------------------------------
function render() {
  $('who').textContent = S.me.name + ' · ' + cap(S.me.role);
  $('gear').classList.toggle('hidden', !isManager());
  const u = unreadCount();
  $('bdot').textContent = u ? String(u) : '';
  $('bdot').classList.toggle('on', u > 0);
  const p = S.page;
  $('page').innerHTML = p === 'issues' ? pageIssues() : p === 'equip' ? pageEquip() : p === 'sched' ? pageSched() : p === 'shop' ? pageShop() : pageArchive();
  $('nav').innerHTML = navHTML();
  if (p === 'issues' && S.me.role !== 'owner') triagePhoto();
  if (p === 'equip') equipThumbs();
  if (p === 'archive' && S.archive.months === null) loadMonths().then(render, (e) => toast(e.message, true));
}

// The triage card shows the first photo large — the one place a photo is
// fetched without opening a sheet, because the photo IS the triage.
async function triagePhoto() {
  const box = $('triage-photo');
  if (!box) return;
  const id = box.getAttribute('data-photo-issue');
  const { data } = await db.from('issue_photos').select('path').eq('issue_id', id).order('uploaded_at').limit(1);
  if (!data || !data.length || !$('triage-photo') || $('triage-photo').getAttribute('data-photo-issue') !== id) return;
  await signPaths([data[0].path]);
  const url = signedUrl(data[0].path);
  if (url && $('triage-photo')) { $('triage-photo').innerHTML = '<img src="' + esc(url) + '" alt="">'; }
}
const THUMB_TRIED = new Set();
async function equipThumbs() {
  const paths = S.equipment.map((e) => e.photo_path).filter(Boolean);
  // Only paths not yet attempted: a path that will not sign (deleted object,
  // offline) must not send render() and equipThumbs() chasing each other.
  const missing = paths.filter((p) => !signedUrl(p) && !THUMB_TRIED.has(p));
  if (!missing.length) return;
  missing.forEach((p) => THUMB_TRIED.add(p));
  await signPaths(missing);
  if (S.page === 'equip' && missing.some((p) => signedUrl(p))) render();
}

async function refresh(quiet) {
  try { await loadAll(); } catch (e) { if (!quiet) toast('Could not refresh: ' + e.message, true); return; }
  render();
  redrawSheet();
}
function redrawSheet() {
  const { type, id } = SHEET;
  if (!type) return;
  if (type === 'issue') sheetIssue(id);
  else if (type === 'equip') sheetEquip(id);
  else if (type === 'sched') sheetSched(id);
  else if (type === 'alerts') sheetAlerts();
  else if (type === 'settings') sheetSettings();
  else if (type === 'staff') sheetStaff(id);
  else if (type === 'areas') sheetAreas();
}

// Every write follows the same shape: do it, reload, redraw, say so.
let BUSY = false;
async function act(fn, okMsg, after) {
  if (BUSY) return;            // a double tap is one tap
  BUSY = true;
  try {
    await fn();
    await loadAll();
    render();
    if (after) after(); else redrawSheet();
    if (okMsg) toast(okMsg);
  } catch (e) {
    toast(friendly(e), true);
  } finally {
    BUSY = false;
  }
}
function friendly(e) {
  const m = (e && e.message) || 'Something went wrong';
  if (/duplicate key/i.test(m)) return 'That name is already in the list.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No connection. Nothing was saved — try again when back online.';
  if (/JWT|expired|not signed in/i.test(m)) return 'Your sign-in expired. Reload the page and sign in again.';
  return m;
}

// ---- photo uploads (visible failure, retry keeps the file) ----------------
let RETRY = null;
function upstat(msg, retry) {
  const el = $('upstat');
  if (!el) return;
  el.innerHTML = retry ? '<span class="bad">' + esc(msg) + '</span> <button class="linklike" data-act="photoretry">Retry</button>' : (msg ? esc(msg) : '');
}
async function uploadIssuePhoto(issueId, file, kind) {
  RETRY = { issueId, file, kind };
  try {
    await addIssuePhoto(issueId, file, kind, (m) => upstat(m));
    RETRY = null;
    await loadAll(); render(); sheetIssue(issueId);
    toast('Photo added');
  } catch (e) {
    upstat(e.message, true);
  }
}
async function uploadEquipPhoto(eqId, file) {
  RETRY = { eqId, file };
  try {
    const { path } = await uploadPhoto('equipment/' + eqId, file, (m) => upstat(m));
    await setEquipmentState(eqId, { photo_path: path });
    RETRY = null;
    await loadAll(); await signPaths([path]); render(); sheetEquip(eqId);
    toast('Photo updated');
  } catch (e) {
    upstat(e.message, true);
  }
}

// ---- auth ------------------------------------------------------------------
let picked = null;

async function boot() {
  const { data: { session } } = await db.auth.getSession();
  if (session) {
    const me = await loadMe(session.user);
    if (me) return start(me);
    await db.auth.signOut();
    $('loginError').textContent = 'This account is no longer active.';
    $('loginError').classList.remove('hidden');
  }
  showLogin();
}

async function showLogin() {
  $('app').classList.add('hidden');
  $('login').classList.remove('hidden');
  pickUser(null);
  let roster = [];
  try { roster = await loadRoster(); } catch (e) { $('loginError').textContent = 'Could not reach the server. Check the connection and refresh.'; $('loginError').classList.remove('hidden'); }
  const wrap = $('loginPicker');
  wrap.innerHTML = '';
  for (const u of roster) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'user-btn';
    const av = document.createElement('span'); av.className = 'av ' + u.role; av.textContent = u.name.charAt(0);
    const txt = document.createElement('span');
    const un = document.createElement('span'); un.className = 'un'; un.textContent = u.name;
    const ur = document.createElement('span'); ur.className = 'ur'; ur.textContent = cap(u.role);
    txt.appendChild(un); txt.appendChild(ur);
    btn.appendChild(av); btn.appendChild(txt);
    btn.onclick = () => pickUser(u);
    wrap.appendChild(btn);
  }
}
function pickUser(u) {
  picked = u;
  $('loginPicker').classList.toggle('hidden', !!u);
  $('loginPinWrap').classList.toggle('hidden', !u);
  if (u) { $('loginWho').textContent = 'Hi ' + u.name; $('loginPin').value = ''; $('loginPin').focus(); }
}
$('pickSomeoneElse').onclick = () => pickUser(null);
$('loginPin').oninput = async (e) => {
  const pin = e.target.value.replace(/\D/g, '').slice(0, 4);
  e.target.value = pin;
  $('loginError').classList.add('hidden');
  if (pin.length !== 4 || !picked) return;
  e.target.disabled = true;
  const { data, error } = await signIn(picked.slug, pin);
  e.target.disabled = false;
  if (error) {
    $('loginPin').value = '';
    $('loginError').textContent = error.message === 'Invalid login credentials' ? 'Wrong PIN. Try again.' : error.message;
    $('loginError').classList.remove('hidden');
    $('loginPin').focus();
    return;
  }
  const me = await loadMe(data.user);
  if (!me) { await db.auth.signOut(); $('loginError').textContent = 'This account is not active.'; $('loginError').classList.remove('hidden'); return; }
  start(me);
};

async function start(me) {
  S.me = me;
  S.page = 'issues';
  try { S.viewMode = localStorage.getItem('tm-view') || 'urgency'; } catch (e) { /* fine */ }
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('page').innerHTML = '<p class="empty"><span class="spin">✸</span><br>Loading…</p>';
  try { await loadAll(); } catch (e) { $('page').innerHTML = '<p class="empty">' + esc(e.message) + '<br><button class="linklike" data-act="reload">Try again</button></p>'; return; }
  render();
}

// ---- events ----------------------------------------------------------------
function findAttr(t, name) {
  while (t && t !== document.body) {
    if (t.getAttribute && t.getAttribute(name) != null) return t;
    t = t.parentNode;
  }
  return null;
}
function pressPill(el) {
  const wrap = el.closest('.pills');
  if (!wrap) return;
  for (const p of wrap.querySelectorAll('.pill')) p.setAttribute('aria-pressed', String(p === el));
}
const pinOk = (p) => /^\d{4}$/.test(p);

document.addEventListener('click', async (ev) => {
  let el, v;
  if (!S.me) return;

  if ((el = findAttr(ev.target, 'data-page'))) { S.page = el.getAttribute('data-page'); render(); window.scrollTo(0, 0); return; }
  if ((el = findAttr(ev.target, 'data-score'))) { S.scoreFilter = el.getAttribute('data-score'); render(); return; }
  if ((el = findAttr(ev.target, 'data-view'))) { S.viewMode = el.getAttribute('data-view'); try { localStorage.setItem('tm-view', S.viewMode); } catch (e) { /* fine */ } render(); return; }
  if ((el = findAttr(ev.target, 'data-eqf'))) { S.eqFilter = el.getAttribute('data-eqf'); render(); return; }
  if ((el = findAttr(ev.target, 'data-month'))) {
    const ym = el.getAttribute('data-month');
    S.archive.loading = true; S.archive.area = ''; S.archive.cat = '';
    sheetArchiveMonth(ym);
    try { await loadMonth(ym); } catch (e) { toast(e.message, true); }
    S.archive.loading = false;
    if (SHEET.type === 'month' && SHEET.id === ym) sheetArchiveMonth(ym);
    return;
  }
  if ((el = findAttr(ev.target, 'data-photo'))) { showPhoto(el.getAttribute('data-photo')); return; }
  if ((el = findAttr(ev.target, 'data-alert'))) {
    const a = S.alerts.find((x) => x.id === el.getAttribute('data-alert'));
    if (!a) return;
    if (alertUnread(a)) { try { await markAlertsRead([a.id]); } catch (e) { /* stays unread; not worth a toast */ } }
    render();
    if (a.issue_id) {
      if (!findIssue(a.issue_id)) { try { await loadIssueById(a.issue_id); } catch (e) { toast(e.message, true); } }
      if (findIssue(a.issue_id)) sheetIssue(a.issue_id); else sheetAlerts();
    }
    else if (a.schedule_id && findSched(a.schedule_id)) sheetSched(a.schedule_id);
    else sheetAlerts();
    return;
  }

  // pills that only mark a choice (saved by the sheet's Save button)
  if (ev.target.closest && ev.target.closest('.pill') && !findAttr(ev.target, 'data-assign') && !findAttr(ev.target, 'data-srole')) {
    const pill = ev.target.closest('.pill');
    if (pill.classList.contains('locked')) return;
    pressPill(pill); return;
  }

  if ((el = findAttr(ev.target, 'data-assign'))) {
    v = el.getAttribute('data-assign').split(':');
    const s = S.staff.find((x) => x.id === v[1]);
    if (!s) return;
    const id = v[0];
    return act(() => updateIssue(id, { assigned_to_name: s.name, assigned_to_id: s.id }), 'Assigned to ' + s.name, () => sheetIssue(id));
  }
  if ((el = findAttr(ev.target, 'data-srole'))) {
    v = el.getAttribute('data-srole').split(':');
    const u = S.staff.find((x) => x.id === v[0]);
    if (!u) return;
    if (!isOwner()) return toast('Only the owner can change roles');
    if (u.role === 'owner') return toast('The owner cannot be demoted');
    if (v[1] === 'owner') return toast('There can only be one owner');
    if (u.role === v[1]) return;
    return act(() => manageStaff({ action: 'set_role', id: u.id, role: v[1] }), u.name + ' is now ' + v[1], () => sheetStaff(u.id));
  }

  if ((el = findAttr(ev.target, 'data-tick'))) {
    const key = el.getAttribute('data-tick');
    const r = shoppingRows().find((x) => x.key === key);
    if (!r) return;
    if (r.equip) return sheetRestock(key);
    if (r.acquired) return act(() => unacquireItems(r.ids), 'Unticked');
    return act(() => acquireItems(r.ids), r.ids.length > 1 ? 'Marked as bought on ' + r.ids.length + ' work orders' : 'Marked as bought');
  }
  if ((el = findAttr(ev.target, 'data-tickitem'))) {
    const it = findItem(el.getAttribute('data-tickitem'));
    if (!it) return;
    if (it.acquired) return act(() => unacquireItems([it.id]), 'Unticked');
    return act(() => acquireItems([it.id]), 'Marked as bought');
  }
  if ((el = findAttr(ev.target, 'data-shop'))) {
    const r = shoppingRows().find((x) => x.key === el.getAttribute('data-shop'));
    if (!r) return;
    if (r.equip) return sheetEquip(r.equip.id);
    return sheetItem(r.ids[0]);
  }
  if ((el = findAttr(ev.target, 'data-item'))) { sheetItem(el.getAttribute('data-item')); return; }
  if ((el = findAttr(ev.target, 'data-issue')) && el.getAttribute('data-issue')) { sheetIssue(el.getAttribute('data-issue')); return; }
  if ((el = findAttr(ev.target, 'data-eq'))) { sheetEquip(el.getAttribute('data-eq')); return; }
  if ((el = findAttr(ev.target, 'data-sched')) && el.getAttribute('data-sched')) { sheetSched(el.getAttribute('data-sched')); return; }
  if ((el = findAttr(ev.target, 'data-staff'))) { sheetStaff(el.getAttribute('data-staff')); return; }
  if ((el = findAttr(ev.target, 'data-area'))) { sheetAreaForm(el.getAttribute('data-area')); return; }

  el = findAttr(ev.target, 'data-act');
  if (!el) return;
  const a = el.getAttribute('data-act'), id = el.getAttribute('data-id') || null;

  switch (a) {
    case 'close': closeSheet(); return;
    case 'back': {
      const iss = el.getAttribute('data-for-issue'), sc = el.getAttribute('data-for-sched');
      if (iss) sheetIssue(iss); else if (sc) sheetSched(sc); else closeSheet();
      return;
    }
    case 'reload': location.reload(); return;
    case 'exp': S.expOpen = !S.expOpen; render(); return;
    case 'me': sheetMe(); return;
    case 'logout': await db.auth.signOut(); location.reload(); return;
    case 'alerts': sheetAlerts(); return;
    case 'readall': return act(() => markAlertsRead(S.alerts.filter(alertUnread).map((x) => x.id)), null, () => sheetAlerts());
    case 'settings': sheetSettings(); return;
    case 'areas': sheetAreas(); return;
    case 'addstaff': sheetAddStaff(); return;
    case 'addeq': sheetEquipForm(null); return;
    case 'addsched': sheetSchedForm(null); return;
    case 'report': sheetReport(); return;
    case 'changepin': sheetPin(null); return;
    case 'resetpin': sheetPin(id); return;
    case 'staffback': sheetStaff(id); return;
    case 'editissue': sheetEditIssue(id); return;
    case 'assign': sheetAssign(id); return;
    case 'finish': sheetFinish(id); return;
    case 'eqedit': sheetEquipForm(id); return;
    case 'schedit': sheetSchedForm(id); return;
    case 'addarea': sheetAreaForm(null, id); return;

    // ---- triage ----
    case 'skip': { const q = triageQueue(); S.triage = (S.triage + 1) % Math.max(q.length, 1); render(); return; }
    case 'take': {
      const i = findIssue(id); if (!i) return;
      const patch = { acknowledged_at: i.acknowledged_at || new Date().toISOString() };
      if (!i.assigned_to_name) { patch.assigned_to_name = S.me.name; patch.assigned_to_id = S.me.id; }
      return act(() => updateIssue(id, patch), i.assigned_to_name ? 'Marked as seen' : "You've taken this on", () => { S.triage = 0; render(); });
    }

    // ---- work order transitions ----
    case 'ack': return act(() => updateIssue(id, { acknowledged_at: new Date().toISOString() }), 'Marked as seen', () => sheetIssue(id));
    case 'start': {
      const i = findIssue(id); if (!i) return;
      const patch = { started_at: new Date().toISOString() };
      if (!i.acknowledged_at) patch.acknowledged_at = patch.started_at;
      if (!i.assigned_to_name) { patch.assigned_to_name = S.me.name; patch.assigned_to_id = S.me.id; }
      return act(() => updateIssue(id, patch), 'Work started', () => sheetIssue(id));
    }
    case 'savefinish': {
      const note = val('f-note');
      return act(() => updateIssue(id, { completed_at: new Date().toISOString(), resolution_note: note || null }), 'Marked as fixed — now add the after photo', () => sheetIssue(id));
    }
    case 'reopen': {
      if (!confirm('Reopen this work order? Its history stays.')) return;
      return act(() => updateIssue(id, { completed_at: null }), 'Reopened — history kept', () => sheetIssue(id));
    }
    case 'saveassign': {
      const ext = val('as-ext');
      if (!ext) return sheetIssue(id);
      return act(() => updateIssue(id, { assigned_to_name: ext, assigned_to_id: null }), 'Assigned to ' + ext, () => sheetIssue(id));
    }
    case 'saveissue': {
      const title = val('e-title');
      if (!title) return toast("Say what's wrong first", true);
      return act(() => updateIssue(id, {
        title, area_id: val('e-area'), category: val('e-cat'), priority: pressed('e-prio', 'prio') || 'routine',
        description: val('e-note') || null, vendor_contact: val('e-vendor') || null,
      }), 'Saved', () => sheetIssue(id));
    }
    case 'addnote': sheetText('Add a note', 'Note', 'Parts ordered, contractor coming Thursday…', 'savenote', id, '', 'data-issue="' + esc(id) + '"'); return;
    case 'savenote': {
      const body = val('t-val');
      if (!body) return toast('Write something first', true);
      return act(() => addNote(id, body), 'Note added', () => sheetIssue(id));
    }
    case 'photo': {
      const file = await pickPhoto(); if (!file) return;
      return uploadIssuePhoto(id, file, el.getAttribute('data-kind') || 'before');
    }
    case 'photoretry': {
      if (!RETRY) return;
      if (RETRY.issueId) return uploadIssuePhoto(RETRY.issueId, RETRY.file, RETRY.kind);
      if (RETRY.eqId) return uploadEquipPhoto(RETRY.eqId, RETRY.file);
      return;
    }

    // ---- report ----
    case 'pickphoto': {
      const file = await pickPhoto(); if (!file) return;
      S.pendingPhoto = file;
      if ($('pickphoto-label')) $('pickphoto-label').textContent = 'Photo attached ✓ · tap to change';
      return;
    }
    case 'postissue': {
      if (BUSY) return;
      // a prefilled "Chainsaw — " left untouched should not post as a dangling dash
      const title = val('r-title').replace(/[\s—–:-]+$/, '').trim();
      if (!title) return toast("Say what's wrong first", true);
      const fields = { area_id: val('r-area'), equipment_id: val('r-eq') || null, title, category: val('r-cat'), priority: pressed('r-prio', 'prio') || 'routine', description: val('r-note') || null };
      const photo = S.pendingPhoto; S.pendingPhoto = null;
      BUSY = true;
      try {
        const row = await reportIssue(fields);
        await loadAll(); S.triage = 0; S.page = 'issues'; render();
        toast('Posted — nobody has seen it yet');
        await sheetIssue(row.id);
        if (photo) uploadIssuePhoto(row.id, photo, 'before');
      } catch (e) { S.pendingPhoto = photo; toast(friendly(e), true); }
      finally { BUSY = false; }
      return;
    }

    // ---- items ----
    case 'additem': {
      // data-for-* on purpose: a plain data-issue here would be caught by the
      // "open this work order" branch above and the button would do nothing.
      const iss = el.getAttribute('data-for-issue'), sc = el.getAttribute('data-for-sched');
      if (!sc && !iss && !openIssues().length) return toast('No open work order to add it to', true);
      sheetAddItem({ issue_id: iss || null, schedule_id: sc || null }); return;
    }
    case 'saveadd': {
      const name = val('a-name');
      if (!name) return toast('Name the item first', true);
      const fields = { name, qty: num('a-qty') || 1, unit: val('a-unit') || null, note: val('a-note') || null,
        issue_id: val('a-sched') ? null : val('a-issue'), schedule_id: val('a-sched') || null };
      if (!fields.issue_id && !fields.schedule_id) return toast('Pick a work order', true);
      return act(() => addItem(fields), 'Added', () => fields.issue_id ? sheetIssue(fields.issue_id) : sheetSched(fields.schedule_id));
    }
    case 'itemsave': {
      const it = findItem(id); if (!it) return;
      const name = val('f-name') || it.name;
      const patch = { name, qty: num('f-qty') || 1, unit: val('f-unit') || null, note: val('f-note') || null };
      return act(() => updateItem(id, patch), 'Saved', () => it.issue_id ? sheetIssue(it.issue_id) : sheetSched(it.schedule_id));
    }
    case 'itemdelete': {
      const it = findItem(id); if (!it) return;
      return act(() => deleteItem(id), 'Removed', () => it.issue_id ? sheetIssue(it.issue_id) : sheetSched(it.schedule_id));
    }
    case 'saverestock': {
      const r = shoppingRows().find((x) => x.key === el.getAttribute('data-key'));
      if (!r || !r.equip) return;
      const added = num('p-added');
      if (!added || added <= 0) return toast('How many did you add?', true);
      return act(() => restockEquipment(r.equip.id, added), 'Restocked ' + r.name, () => closeSheet());
    }

    // ---- equipment ----
    case 'eqsave': {
      const cond = pressed('eq-cond', 'cond'), qty = num('eqq');
      const e = findEquip(id); if (!e) return;
      return act(() => setEquipmentState(id, { condition: cond, qty: qty != null ? qty : null }), 'Equipment updated', () => {
        if (cond === 'broken' && e.condition !== 'broken' && !openIssueOfEquip(id)) sheetReport({ equipment_id: id, area_id: e.area_id, title: e.name + ' — ', category: 'Appliance' });
        else closeSheet();
      });
    }
    case 'eqreport': { const e = findEquip(id); if (!e) return; sheetReport({ equipment_id: id, area_id: e.area_id, title: e.name + ' — ', category: e.category === 'Pool' ? 'Plumbing' : 'Appliance' }); return; }
    case 'eqnote': { const e = findEquip(id); sheetText('Equipment note', 'Note', 'How to use it, quirks, where the spare is…', 'saveeqnote', id, e ? e.note : '', 'data-eq="' + esc(id) + '"'); return; }
    case 'saveeqnote': return act(() => setEquipmentState(id, { note: val('t-val') }), 'Saved', () => sheetEquip(id));
    case 'eqphoto': { const file = await pickPhoto(); if (!file) return; return uploadEquipPhoto(id, file); }
    case 'eqformsave': {
      const name = val('q-name');
      if (!name) return toast('Name it first', true);
      const fields = { name, category: val('q-cat'), area_id: val('q-area'), qty: num('q-qty') ?? 1, unit: val('q-unit') || null,
        low_stock_threshold: num('q-low'), service_interval_months: num('q-int'), last_serviced_at: val('q-last') || null,
        purchase_date: val('q-bought') || null, warranty_expires: val('q-warr') || null, note: val('q-note') || null };
      return act(async () => { const row = await saveEquipment(id, fields); fields.id = row.id; }, id ? 'Saved' : 'Added', () => sheetEquip(fields.id));
    }
    case 'eqarchive': {
      if (!confirm('Archive this item? It leaves the list but stays in history.')) return;
      return act(() => archiveEquipment(id, true), 'Archived', () => closeSheet());
    }

    // ---- schedules ----
    case 'schdone': sheetSchedDone(id); return;
    case 'saveschdone': return act(() => completeSchedule(id, val('sd-note')), 'Logged as done', () => closeSheet());
    case 'schedsave': {
      const task = val('sc-task'), interval = num('sc-int'), due = val('sc-due');
      if (!task) return toast('Name the task first', true);
      if (!interval || interval < 1) return toast('How often, in months?', true);
      if (!due) return toast('Pick the next due date', true);
      const fields = { task, area_id: val('sc-area'), interval_months: Math.round(interval), next_due_at: due, note: val('sc-note') || null };
      return act(async () => { const row = await saveSchedule(id, fields); fields.id = row.id; }, id ? 'Saved' : 'Scheduled', () => sheetSched(fields.id));
    }
    case 'schedarchive': {
      if (!confirm('Archive this schedule? Its completion history stays.')) return;
      return act(() => archiveSchedule(id), 'Archived', () => closeSheet());
    }

    // ---- settings ----
    case 'savestaff': {
      const name = val('ns-name'), pin = val('ns-pin'), role = pressed('ns-role', 'nsrole') || 'staff';
      if (!name) return toast('Name them first', true);
      if (!pinOk(pin)) return toast('PIN must be 4 digits', true);
      if (role === 'admin' && !isOwner()) return toast('Only the owner can create an admin', true);
      return act(() => manageStaff({ action: 'add', name, role, pin }), name + ' added as ' + role, () => sheetSettings());
    }
    case 'savepin': {
      const p1 = val('pin-new'), p2 = val('pin-again');
      if (!pinOk(p1)) return toast('PIN must be 4 digits', true);
      if (p1 !== p2) return toast('The two PINs do not match', true);
      const self = !id || id === S.me.id;
      return act(() => manageStaff({ action: 'set_pin', id: id || undefined, pin: p1 }), self ? 'Your PIN is changed' : 'PIN reset', () => self ? closeSheet() : sheetStaff(id));
    }
    case 'deact': {
      const u = S.staff.find((x) => x.id === id); if (!u) return;
      if (!confirm('Deactivate ' + u.name + '? They can no longer sign in; their name stays on everything they did.')) return;
      return act(() => manageStaff({ action: 'deactivate', id }), 'Deactivated — history kept', () => sheetSettings());
    }
    case 'react': return act(() => manageStaff({ action: 'reactivate', id }), 'Reactivated', () => sheetSettings());
    case 'delstaff': {
      const u = S.staff.find((x) => x.id === id); if (!u) return;
      if (!confirm('Delete ' + u.name + ' for good? Their login stops working and they leave the list. Anything they logged keeps their name.')) return;
      return act(() => manageStaff({ action: 'delete', id }), u.name + ' removed', () => sheetSettings());
    }
    case 'areasave': {
      const name = val('ar-name');
      if (!name) return toast('Name the area first', true);
      return act(() => saveArea(id, { name, group_id: val('ar-group'), archived_at: id ? (areaById(id) || {}).archived_at : null }), 'Saved', () => sheetAreas());
    }
    case 'areaarchive': {
      const ar = areaById(id); if (!ar) return;
      const archiving = !ar.archived_at;
      if (archiving && openIssues().some((i) => i.area_id === id) && !confirm('This area still has open issues. Archive it anyway?')) return;
      return act(() => saveArea(id, { name: ar.name, group_id: ar.group_id, archived_at: archiving ? new Date().toISOString() : null }), archiving ? 'Archived' : 'Back in the list', () => sheetAreas());
    }
    default: return;
  }
});

// selects and numeric settings
document.addEventListener('change', (ev) => {
  const el = findAttr(ev.target, 'data-change');
  if (!el || !S.me) return;
  const what = el.getAttribute('data-change');
  if (what === 'shoparea') { S.shopArea = el.value; render(); }
  else if (what === 'archarea') { S.archive.area = el.value; sheetArchiveMonth(S.archive.month); }
  else if (what === 'archcat') { S.archive.cat = el.value; sheetArchiveMonth(S.archive.month); }
  else if (what === 'staledays') {
    const n = Math.round(Number(el.value));
    if (!(n >= 1 && n <= 60)) return toast('Between 1 and 60 days', true);
    act(() => saveSettings({ stale_after_days: n }), 'Saved', () => {});
  }
  // area change on the report sheet refreshes the duplicate warning
  if (ev.target.id === 'r-area' && $('r-dupes')) $('r-dupes').innerHTML = dupesHTML(ev.target.value);
});

// by-area search: filter without losing the caret
document.addEventListener('input', (ev) => {
  if (ev.target.id !== 'srch') return;
  S.search = ev.target.value;
  if ($('exp-rows')) $('exp-rows').innerHTML = byAreaRowsHTML();
});

$('veil').addEventListener('click', (ev) => { if (ev.target === $('veil')) closeSheet(); });
$('lightbox').addEventListener('click', () => { $('lightbox').className = 'lightbox'; });
$('who').onclick = () => sheetMe();
$('bell').onclick = () => sheetAlerts();
$('gear').onclick = () => sheetSettings();

// Keep the phone honest: refresh when it wakes, and every few minutes while
// open. Silent on failure — the last good state stays on screen.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S.me && Date.now() - S.loadedAt > 60 * 1000) refresh(true);
});
setInterval(() => { if (!document.hidden && S.me && !SHEET.type) refresh(true); }, 3 * MIN);

boot();
