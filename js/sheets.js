// Tanawin Maintenance — bottom sheets. Detail opens as a sheet, not a route
// change, so staff keep their place in the list. One primary action per
// sheet, changing with stage (spec §11).
'use strict';

const SHEET = { type: null, id: null };   // what is open, so refreshes can redraw it

function openSheet(html, type, id) {
  SHEET.type = type || null; SHEET.id = id || null;
  $('sheet').innerHTML = html;
  $('veil').className = 'veil on';
  $('sheet').scrollTop = 0;
}
function closeSheet() { SHEET.type = null; SHEET.id = null; $('veil').className = 'veil'; }
function sheetHead(title) {
  return '<div class="sheet-hd"><h3>' + esc(title) + '</h3><button class="x" data-act="close" aria-label="Close">×</button></div>';
}
function field(label, inner, hint) {
  return '<div class="field"><label>' + esc(label) + '</label>' + inner + (hint ? '<p class="hint">' + hint + '</p>' : '') + '</div>';
}
function pills(id, options, current, attr) {
  return '<div class="pills" id="' + id + '">' + options.map((o) =>
    '<button type="button" class="pill" data-' + attr + '="' + esc(o.value) + '" aria-pressed="' + (o.value === current) + '">' + esc(o.label) + '</button>').join('') + '</div>';
}
function pressed(containerId, attr) {
  const el = document.querySelector('#' + containerId + ' .pill[aria-pressed="true"]');
  return el ? el.getAttribute('data-' + attr) : null;
}
function areaSelect(id, current, includeArchivedId) {
  let h = '<select id="' + id + '">';
  for (const g of S.groups) {
    const list = S.areas.filter((a) => a.group_id === g.id && (!a.archived_at || a.id === includeArchivedId));
    if (!list.length) continue;
    h += '<optgroup label="' + esc(g.name) + '">' + list.map((a) => '<option value="' + a.id + '"' + (a.id === current ? ' selected' : '') + '>' + esc(a.name) + (a.archived_at ? ' (archived)' : '') + '</option>').join('') + '</optgroup>';
  }
  return h + '</select>';
}
const num = (id) => { const v = $(id) ? $(id).value.trim() : ''; return v === '' ? null : Number(v); };
const val = (id) => ($(id) ? $(id).value.trim() : '');

// ---- work order ------------------------------------------------------------
async function sheetIssue(id) {
  const i = findIssue(id);
  if (!i) return toast('That work order is not loaded', true);
  openSheet(sheetHead(areaName(i.area_id)) + '<p class="empty">Loading…</p>', 'issue', id);
  let d;
  try { d = await loadIssueDetail(id); } catch (e) { return openSheet(sheetHead(areaName(i.area_id)) + '<p class="empty">' + esc(e.message) + '</p>', 'issue', id); }
  if (SHEET.type !== 'issue' || SHEET.id !== id) return;   // user moved on
  const st = stage(i);
  const blocks = groupOfArea(i.area_id).blocks_booking && !i.completed_at;
  const eq = i.equipment_id ? findEquip(i.equipment_id) : null;
  let h = sheetHead(areaName(i.area_id)) + '<div class="sbody">';
  h += '<div class="pad top"><p class="sheet-title">' + esc(i.title) + '</p>' +
    '<div class="c-tags">' + prioTag(i.priority) + tag('neutral', i.category) + (blocks ? tag('urgent', 'Blocks booking') : '') +
    (i.reopened_count ? tag('neutral', 'Reopened ' + i.reopened_count + '×') : '') + '</div>' +
    (i.description ? '<p class="desc">' + esc(i.description) + '</p>' : '') +
    (eq ? '<p class="desc"><button class="linklike" data-eq="' + eq.id + '">🧰 ' + esc(eq.name) + '</button></p>' : '') +
    (i.vendor_contact ? '<p class="desc">Contractor: ' + esc(i.vendor_contact) + '</p>' : '') +
    '<p class="desc"><button class="linklike" data-act="editissue" data-id="' + i.id + '">Edit details</button></p></div>';

  h += '<div class="photos">';
  for (const p of d.photos) {
    const u = signedUrl(p.path);
    h += '<button class="thumb" data-photo="' + esc(p.path) + '">' + (u ? '<img src="' + esc(u) + '" alt="">' : '📷') + '<span>' + esc(p.kind) + '</span></button>';
  }
  h += '</div>';
  h += '<button class="photo-add" data-act="photo" data-id="' + i.id + '" data-kind="' + (i.completed_at ? 'after' : 'before') + '"><span class="ic">📷</span>' +
    (i.completed_at ? 'Add an after photo' : 'Add a photo') + '</button><div id="upstat" class="upstat"></div>';

  h += '<div class="timeline">' +
    '<div class="tl done"><span class="tdot"></span><div><p>Reported</p><small>' + esc(i.reported_by_name) + ' · ' + esc(rel(i.reported_at)) + '</small></div></div>' +
    '<div class="tl ' + (i.acknowledged_at ? 'done' : 'now') + '"><span class="tdot"></span><div><p>Seen</p><small>' + (i.acknowledged_at ? esc(i.acknowledged_by_name) + ' · ' + esc(rel(i.acknowledged_at)) : 'Nobody yet') + '</small></div></div>' +
    '<div class="tl ' + (st >= 2 ? 'done' : '') + '"><span class="tdot"></span><div><p>Work started</p><small>' + (i.started_at ? esc(i.started_by_name || '') + ' · ' + esc(rel(i.started_at)) : 'Not started') + '</small></div></div>' +
    '<div class="tl ' + (st >= 3 ? 'done' : '') + '"><span class="tdot"></span><div><p>Fixed</p><small>' + (i.completed_at ? esc(i.completed_by_name || '') + ' · ' + esc(rel(i.completed_at)) : '—') + '</small></div></div>' +
    '</div>';
  if (i.resolution_note) h += '<div class="boxed"><div class="hdr"><h4>HOW IT WAS FIXED</h4></div><div class="nt"><p>' + esc(i.resolution_note) + '</p></div></div>';

  h += '<div class="boxed"><div class="hdr"><h4>ASSIGNED TO</h4><button data-act="assign" data-id="' + i.id + '">Change</button></div>' +
    '<div class="nt"><p>' + esc(i.assigned_to_name || 'Nobody yet') + '</p></div></div>';

  h += '<div class="boxed"><div class="hdr"><h4>MATERIALS TO BUY</h4><button data-act="additem" data-for-issue="' + i.id + '">Add</button></div>';
  if (!(i.items || []).length) h += '<div class="nt"><small>Nothing needed yet.</small></div>';
  for (const it of i.items || []) h += itemRowHTML(it);
  h += '</div>';

  h += '<div class="boxed"><div class="hdr"><h4>NOTES</h4><button data-act="addnote" data-id="' + i.id + '">Add</button></div>';
  if (!d.notes.length) h += '<div class="nt"><small>No notes yet.</small></div>';
  for (const n of d.notes) h += '<div class="nt"><p>' + esc(n.body) + '</p><small>' + esc(n.author_name) + ' · ' + esc(rel(n.created_at)) + '</small></div>';
  h += '</div>';

  if (d.events.length > 1 || i.reopened_count) {
    h += '<div class="boxed"><div class="hdr"><h4>HISTORY</h4></div>';
    for (const e of d.events) h += '<div class="nt slim"><small><b>' + esc(e.actor_name) + '</b> ' + esc(eventLabel(e)) + ' · ' + esc(fmtDateTime(e.at)) + '</small></div>';
    h += '</div>';
  }

  h += '<div class="sheet-actions">';
  // The owner posts most issues, so "Mark as seen" is meaningless for her:
  // her slot assigns (or reassigns) until someone else has looked, unless
  // she has taken it herself — then it is simply "Start work".
  const ownerSlot = S.me.role === 'owner' && !i.acknowledged_at && i.assigned_to_id !== S.me.id;
  if (i.completed_at) h += '<button data-act="reopen" data-id="' + i.id + '">Reopen</button>';
  else if (ownerSlot) h += '<button class="primary" data-act="assign" data-id="' + i.id + '">' + (i.assigned_to_name ? 'Reassign' : 'Assign to someone') + '</button>';
  else if (!i.acknowledged_at && i.assigned_to_id !== S.me.id) h += '<button class="primary" data-act="ack" data-id="' + i.id + '">Mark as seen</button>';
  else if (!i.started_at) h += '<button class="primary" data-act="start" data-id="' + i.id + '">Start work</button>';
  else h += '<button class="primary" data-act="finish" data-id="' + i.id + '">Mark as fixed</button>';
  h += '<button data-act="close">Close</button></div></div>';
  openSheet(h, 'issue', id);
}

function eventLabel(e) {
  switch (e.kind) {
    case 'reported': return 'reported it (' + e.to_value + ')';
    case 'acknowledged': return 'saw it';
    case 'assigned': return 'assigned it to ' + e.to_value;
    case 'started': return 'started work';
    case 'fixed': return 'marked it fixed';
    case 'reopened': return 'reopened it';
    case 'priority': return 'changed priority ' + e.from_value + ' → ' + e.to_value;
    case 'edited': return 'edited the details';
    default: return e.kind;
  }
}

function itemRowHTML(it) {
  const q = Number(it.qty) || 1, prices = showPrices();
  const amt = it.acquired ? (it.actual_unit_price != null ? peso(it.actual_unit_price * q) : '—') : (it.estimated_unit_price != null ? peso(it.estimated_unit_price * q) : '—');
  return '<div class="ck' + (it.acquired ? ' got' : '') + '">' +
    '<button class="box" data-tickitem="' + it.id + '" aria-label="' + (it.acquired ? 'Untick' : 'Mark as bought') + '">' + (it.acquired ? '✓' : '') + '</button>' +
    '<button class="txt" data-item="' + it.id + '"><p>' + esc(it.name) + (q > 1 ? ' ×' + esc(q) : '') + (it.unit ? ' ' + esc(it.unit) : '') + '</p>' +
    (it.note ? '<small class="note">' + esc(it.note) + '</small>' : '<small>tap to add a note</small>') + '</button>' +
    (prices ? '<button class="amt" data-item="' + it.id + '">' + amt + '<small>' + (it.acquired ? 'paid' : 'estimate') + '</small></button>' : '') + '</div>';
}

function sheetReport(prefill) {
  prefill = prefill || {};
  S.pendingPhoto = null;
  const areaId = prefill.area_id || (activeAreas()[0] || {}).id;
  let h = sheetHead('Report an issue') + '<div class="sbody">';
  h += '<button class="photo-add" data-act="pickphoto"><span class="ic">📷</span><span id="pickphoto-label">Take or upload a photo</span></button>';
  h += field('Where', areaSelect('r-area', areaId));
  if (prefill.equipment_id) h += '<input type="hidden" id="r-eq" value="' + esc(prefill.equipment_id) + '">';
  h += field('What is wrong', '<input id="r-title" maxlength="200" placeholder="e.g. Broken light over the stairs" value="' + esc(prefill.title || '') + '">');
  h += field('Category', '<select id="r-cat">' + CATEGORIES.map((c) => '<option' + (c === (prefill.category || '') ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>');
  h += field('Priority', pills('r-prio', PRIORITIES.map((p) => ({ value: p, label: cap(p) })), 'routine', 'prio'));
  h += field('Details', '<textarea id="r-note" maxlength="4000" placeholder="Anything useful for whoever picks this up"></textarea>');
  h += '<div id="r-dupes">' + dupesHTML(areaId) + '</div>';
  h += '<div class="sheet-actions"><button class="primary" data-act="postissue">Post it</button><button data-act="close">Cancel</button></div></div>';
  openSheet(h, 'report');
}
// Duplicate prevention (spec §5): show what is already open here first.
function dupesHTML(areaId) {
  const open = openIssues().filter((i) => i.area_id === areaId);
  if (!open.length) return '';
  return '<div class="note"><b>' + open.length + (open.length === 1 ? ' open issue already exists' : ' open issues already exist') + ' in this area.</b> Check you are not reporting the same thing twice.' +
    open.slice(0, 5).map((i) => '<br>· <button class="linklike" data-issue="' + i.id + '">' + esc(i.title) + '</button> <small>' + esc(rel(i.reported_at)) + '</small>').join('') + '</div>';
}

function sheetEditIssue(id) {
  const i = findIssue(id);
  if (!i) return;
  let h = sheetHead('Edit work order') + '<div class="sbody">';
  h += field('Where', areaSelect('e-area', i.area_id, i.area_id));
  h += field('What is wrong', '<input id="e-title" maxlength="200" value="' + esc(i.title) + '">');
  h += field('Category', '<select id="e-cat">' + CATEGORIES.map((c) => '<option' + (c === i.category ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>');
  h += field('Priority', pills('e-prio', PRIORITIES.map((p) => ({ value: p, label: cap(p) })), i.priority, 'prio'));
  h += field('Details', '<textarea id="e-note" maxlength="4000">' + esc(i.description || '') + '</textarea>');
  h += field('Outside contractor', '<input id="e-vendor" maxlength="500" placeholder="Name and number, if one is involved" value="' + esc(i.vendor_contact || '') + '">');
  h += '<div class="sheet-actions"><button class="primary" data-act="saveissue" data-id="' + i.id + '">Save</button><button data-issue="' + i.id + '">Back</button></div></div>';
  openSheet(h, 'editissue', id);
}

function sheetFinish(id) {
  const i = findIssue(id);
  if (!i) return;
  let h = sheetHead('Mark as fixed') + '<div class="sbody">';
  h += '<div class="pad top"><p class="sheet-title">' + esc(i.title) + '</p><p class="desc">' + esc(areaName(i.area_id)) + '</p></div>';
  h += field('What was done', '<textarea id="f-note" maxlength="4000" placeholder="Replaced the cylinder, works fine now…"></textarea>',
    'Optional, but the next person who hits the same problem will thank you. You can add an after photo once it is marked fixed.');
  h += '<div class="sheet-actions"><button class="primary" data-act="savefinish" data-id="' + i.id + '">Mark as fixed</button><button data-issue="' + i.id + '">Back</button></div></div>';
  openSheet(h, 'finish', id);
}

function sheetAssign(id) {
  const i = findIssue(id);
  if (!i) return;
  const people = activeStaff();
  let h = sheetHead('Assign to') + '<div class="sbody">';
  h += field('Staff', '<div class="pills">' + people.map((s) =>
    '<button class="pill" data-assign="' + id + ':' + s.id + '" aria-pressed="' + (i.assigned_to_id === s.id) + '">' + esc(s.name) + '</button>').join('') + '</div>');
  const ext = i.assigned_to_name && !i.assigned_to_id ? i.assigned_to_name : '';
  h += field('Or an outside contractor', '<input id="as-ext" maxlength="120" placeholder="e.g. Bataan Power Svc" value="' + esc(ext) + '">');
  h += '<div class="sheet-actions"><button class="primary" data-act="saveassign" data-id="' + id + '">Save</button><button data-issue="' + id + '">Back</button></div></div>';
  openSheet(h, 'assign', id);
}

// ---- items -----------------------------------------------------------------
function catalogDatalist() {
  return '<datalist id="cat-list">' + S.catalog.map((c) => '<option value="' + esc(c.name) + '">').join('') + '</datalist>';
}
function sheetAddItem(target) {
  target = target || {};
  let h = sheetHead('Add an item to buy') + '<div class="sbody">';
  h += field('Item', '<input id="a-name" list="cat-list" maxlength="120" placeholder="Start typing…" autocomplete="off">' + catalogDatalist(),
    'Known items suggest their last paid price automatically.');
  h += '<div class="row2">' + field('Quantity', '<input type="number" id="a-qty" value="1" min="0.01" step="any" inputmode="decimal">') +
    field('Unit', '<input id="a-unit" maxlength="20" placeholder="pcs, kg, m…">') + '</div>';
  if (showPrices()) h += field('Estimated unit price', '<input type="number" id="a-est" placeholder="optional" min="0" step="any" inputmode="decimal">', 'A guess, for planning. Never counted as spend.');
  h += field('Note', '<textarea id="a-note" maxlength="500" placeholder="Size, brand, which shop…"></textarea>');
  if (!target.schedule_id) {
    h += field('For which work order', '<select id="a-issue">' + openIssues().map((i) =>
      '<option value="' + i.id + '"' + (i.id === target.issue_id ? ' selected' : '') + '>' + esc(areaName(i.area_id)) + ' — ' + esc(i.title) + '</option>').join('') + '</select>');
  } else {
    const s = findSched(target.schedule_id);
    h += '<input type="hidden" id="a-sched" value="' + esc(target.schedule_id) + '"><p class="note">For: ' + esc(s ? s.task : 'scheduled task') + '</p>';
  }
  h += '<div class="sheet-actions"><button class="primary" data-act="saveadd">Add</button><button data-act="' + (target.issue_id || target.schedule_id ? 'back' : 'close') + '" data-for-issue="' + esc(target.issue_id || '') + '" data-for-sched="' + esc(target.schedule_id || '') + '">Cancel</button></div></div>';
  openSheet(h, 'additem');
}

function sheetItem(itemId) {
  const it = findItem(itemId);
  if (!it) return;
  const cat = catalogFor(it.name), prices = showPrices();
  const owner = it.issue_id ? findIssue(it.issue_id) : findSched(it.schedule_id);
  const label = it.issue_id ? (owner ? areaName(owner.area_id) + ' — ' + owner.title : '') : (owner ? owner.task : '');
  let h = sheetHead('Edit item') + '<div class="sbody">';
  h += field('Item', '<input id="f-name" list="cat-list" maxlength="120" value="' + esc(it.name) + '" autocomplete="off">' + catalogDatalist());
  if (cat && prices) h += '<p class="note">Last bought at <b>' + peso(cat.last_actual_price) + '</b>' + (cat.last_vendor ? ' from ' + esc(cat.last_vendor) : '') + '. Prices are remembered so the next person does not have to guess.</p>';
  h += '<div class="row2">' + field('Quantity', '<input type="number" id="f-qty" value="' + esc(Number(it.qty)) + '" min="0.01" step="any" inputmode="decimal">') +
    field('Unit', '<input id="f-unit" maxlength="20" value="' + esc(it.unit || '') + '">') + '</div>';
  if (prices) {
    h += field('Estimated unit price', '<input type="number" id="f-est" value="' + (it.estimated_unit_price != null ? esc(it.estimated_unit_price) : '') + '" placeholder="optional" min="0" step="any" inputmode="decimal">', 'A guess, for planning.');
    h += field('Actual paid, per unit', '<input type="number" id="f-act" value="' + (it.actual_unit_price != null ? esc(it.actual_unit_price) : '') + '" placeholder="fill in when bought" min="0" step="any" inputmode="decimal">', 'Filling this in marks the item as bought.');
    h += field('Where from', '<input id="f-vendor" maxlength="120" value="' + esc(it.vendor || cat && cat.last_vendor || '') + '" placeholder="Shop or supplier">');
  }
  h += field('Note', '<textarea id="f-note" maxlength="500" placeholder="Size, brand, which shop, who to ask for…">' + esc(it.note || '') + '</textarea>',
    'Things like “12mm not 10mm” or “ask for Ronnie” — knowledge that is otherwise only in someone’s head.');
  if (label) h += '<p class="note">For: ' + esc(label) + '</p>';
  h += '<div class="sheet-actions"><button class="primary" data-act="itemsave" data-id="' + it.id + '">Save</button>' +
    (it.acquired ? '' : '<button data-act="itemdelete" data-id="' + it.id + '">Remove</button>') +
    '<button data-act="back" data-for-issue="' + esc(it.issue_id || '') + '" data-for-sched="' + esc(it.schedule_id || '') + '">Back</button></div></div>';
  openSheet(h, 'item', itemId);
}

// "What did it cost?" — for one shopping-list line (which may be several
// items with the same name) or a low-stock restock.
// A single checklist line inside one work order ("item:<id>") ticks only
// itself; a shopping-list line ticks every source that needs that name.
function rowForItem(id) {
  const it = findItem(id);
  if (!it) return null;
  const owner = it.issue_id ? findIssue(it.issue_id) : findSched(it.schedule_id);
  return { key: 'item:' + id, name: it.name, unit: it.unit, qty: Number(it.qty) || 1, ids: [it.id], acquired: it.acquired,
    est: it.estimated_unit_price, actual: it.actual_unit_price, group: it.issue_id ? 'repairs' : 'sched', note: it.note ? [it.note] : [],
    vendor: it.vendor, equip: null, area_ids: new Set(), sources: [owner ? (it.issue_id ? owner.title : owner.task) : ''] };
}
function sheetPaid(key) {
  const r = key.startsWith('item:') ? rowForItem(key.slice(5)) : shoppingRows().find((x) => x.key === key);
  if (!r) return;
  const cat = catalogFor(r.name), prices = showPrices();
  const restock = r.group === 'low';
  let h = sheetHead(restock ? 'Restocked' : 'What did it cost?') + '<div class="sbody">';
  h += '<div class="pad top"><p class="sheet-title">' + esc(r.name) + (r.qty > 1 && !restock ? ' ×' + esc(Number(r.qty)) : '') + '</p>' +
    (r.sources.length > 1 ? '<p class="desc">Ticks all ' + r.sources.length + ' work orders that need it.</p>' : '') + '</div>';
  if (restock) h += field('How many did you add?', '<input type="number" id="p-added" value="' + esc(Math.max(1, Number(r.equip.low_stock_threshold || 1) * 2 - Number(r.equip.qty))) + '" min="0.01" step="any" inputmode="decimal">',
    'Stock is ' + esc(Number(r.equip.qty)) + (r.unit ? ' ' + esc(r.unit) : '') + ' now.');
  if (prices) {
    h += field('Actual paid, per unit', '<input type="number" id="p-act" value="' + (r.est != null ? esc(r.est) : cat ? esc(cat.last_actual_price) : '') + '" min="0" step="any" inputmode="decimal" placeholder="optional">',
      'Leave blank if you do not know yet; you can add it later.');
    if (cat) h += '<p class="note">Last paid <b>' + peso(cat.last_actual_price) + '</b>' + (cat.last_vendor ? ' at ' + esc(cat.last_vendor) : '') + '. Saving a different price updates the remembered one.</p>';
    h += field('Where from', '<input id="p-vendor" maxlength="120" value="' + esc(r.vendor || (cat ? cat.last_vendor : '') || '') + '" placeholder="Shop or supplier">');
  }
  h += '<div class="sheet-actions"><button class="primary" data-act="savepaid" data-key="' + esc(key) + '">' + (restock ? 'Save' : 'Mark as bought') + '</button><button data-act="close">Cancel</button></div></div>';
  openSheet(h, 'paid', key);
}

// ---- equipment -------------------------------------------------------------
async function sheetEquip(id) {
  const e = findEquip(id);
  if (!e) return;
  if (e.photo_path && !signedUrl(e.photo_path)) {
    openSheet(sheetHead(e.name) + '<p class="empty">Loading…</p>', 'equip', id);
    await signPaths([e.photo_path]);
    if (SHEET.type !== 'equip' || SHEET.id !== id) return;
  }
  const cond = equipCondition(e), low = isLow(e), url = e.photo_path ? signedUrl(e.photo_path) : '';
  const s = schedOfEquip(e.id), oi = openIssueOfEquip(e.id);
  let h = sheetHead(e.name) + '<div class="sbody">';
  h += '<div class="ehero">' + (url ? '<img src="' + esc(url) + '" alt="" data-photo="' + esc(e.photo_path) + '">' : '<span class="noimg">📷</span>') + '</div>';
  h += '<button class="photo-add" data-act="eqphoto" data-id="' + e.id + '"><span class="ic">📷</span>' + (url ? 'Update the photo' : 'Add a photo so anyone can find it') + '</button><div id="upstat" class="upstat"></div>';
  h += '<div class="boxed">' +
    '<div class="ck"><div class="txt"><p>Condition</p></div><div class="amt">' + (cond === 'broken' ? tag('broken', 'Broken') : cond === 'service due' ? tag('service', 'Service due') : tag('ok', 'Working')) + '</div></div>' +
    '<div class="ck"><div class="txt"><p>Kept in</p></div><div class="amt">' + esc(areaName(e.area_id)) + '</div></div>' +
    '<div class="ck"><div class="txt"><p>Quantity</p>' + (low ? '<small class="note">below the low-stock level of ' + esc(Number(e.low_stock_threshold)) + '</small>' : '') + '</div>' +
    '<div class="amt">' + esc(Number(e.qty)) + (e.unit ? ' ' + esc(e.unit) : '') + '</div></div>' +
    (e.service_interval_months ? '<div class="ck"><div class="txt"><p>Service every</p><small>' + (s ? 'next ' + esc(dueLabel(s.next_due_at)) : 'feeds Scheduled automatically') + '</small></div><div class="amt">' + e.service_interval_months + ' months</div></div>' : '') +
    (e.last_serviced_at ? '<div class="ck"><div class="txt"><p>Last serviced</p></div><div class="amt">' + esc(fmtDate(e.last_serviced_at)) + '</div></div>' : '') +
    (e.purchase_date ? '<div class="ck"><div class="txt"><p>Bought</p></div><div class="amt">' + esc(fmtDate(e.purchase_date)) + (e.purchase_price != null && showPrices() ? ' · ' + peso(e.purchase_price) : '') + '</div></div>' : '') +
    (e.warranty_expires ? '<div class="ck"><div class="txt"><p>Warranty until</p></div><div class="amt">' + esc(fmtDate(e.warranty_expires)) + '</div></div>' : '') +
    '</div>';
  if (oi) h += '<div class="boxed"><div class="hdr"><h4>OPEN WORK ORDER</h4></div><button class="nt full" data-issue="' + oi.id + '"><p>' + esc(oi.title) + '</p><small>' + esc(rel(oi.reported_at)) + ' · ' + esc(oi.assigned_to_name || 'unassigned') + ' ›</small></button></div>';
  h += '<div class="boxed"><div class="hdr"><h4>NOTES</h4><button data-act="eqnote" data-id="' + e.id + '">Edit</button></div>' +
    '<div class="nt"><p>' + (e.note ? esc(e.note) : '<small>No notes yet — how to use it, quirks, where the spare is.</small>') + '</p></div></div>';
  h += field('Set condition', pills('eq-cond', CONDITIONS.map((c) => ({ value: c, label: cap(c) })), e.condition, 'cond'),
    cond === 'service due' && e.condition !== 'service due' ? 'Showing “service due” because its scheduled service is due.' : '');
  h += field('Quantity on hand', '<input type="number" id="eqq" value="' + esc(Number(e.qty)) + '" min="0" step="any" inputmode="decimal">');
  h += '<div class="sheet-actions"><button class="primary" data-act="eqsave" data-id="' + e.id + '">Save</button>' +
    (!oi ? '<button data-act="eqreport" data-id="' + e.id + '">Report a problem</button>' : '') +
    (isManager() ? '<button data-act="eqedit" data-id="' + e.id + '">Edit</button>' : '') +
    '<button data-act="close">Close</button></div></div>';
  openSheet(h, 'equip', id);
}

function sheetEquipForm(id) {
  const e = id ? findEquip(id) : null;
  const v = (k, d) => e && e[k] != null ? e[k] : (d == null ? '' : d);
  let h = sheetHead(e ? 'Edit equipment' : 'Add equipment') + '<div class="sbody">';
  h += field('Name', '<input id="q-name" maxlength="120" value="' + esc(v('name')) + '" placeholder="e.g. Chainsaw, LED bulbs (warm)">');
  h += field('Category', '<select id="q-cat">' + EQUIPMENT_CATEGORIES.map((c) => '<option' + (c === v('category', 'Hand tools') ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>',
    'Consumables are tracked by quantity against a low-stock level; everything else by condition.');
  h += field('Kept in', areaSelect('q-area', v('area_id') || (activeAreas()[0] || {}).id, v('area_id')));
  h += '<div class="row2">' + field('Quantity', '<input type="number" id="q-qty" value="' + esc(v('qty', 1)) + '" min="0" step="any" inputmode="decimal">') +
    field('Unit', '<input id="q-unit" maxlength="20" value="' + esc(v('unit')) + '" placeholder="pcs, kg, L…">') + '</div>';
  h += field('Low-stock level (consumables)', '<input type="number" id="q-low" value="' + esc(v('low_stock_threshold')) + '" min="0" step="any" inputmode="decimal" placeholder="flag when at or below">');
  h += field('Service every (months)', '<input type="number" id="q-int" value="' + esc(v('service_interval_months')) + '" min="1" max="120" inputmode="numeric" placeholder="leave blank if never">',
    'A number here creates the matching entry in Scheduled and keeps it in step.');
  h += '<div class="row2">' + field('Last serviced', '<input type="date" id="q-last" value="' + esc(v('last_serviced_at')) + '">') +
    field('Bought on', '<input type="date" id="q-bought" value="' + esc(v('purchase_date')) + '">') + '</div>';
  h += '<div class="row2">' + field('Warranty until', '<input type="date" id="q-warr" value="' + esc(v('warranty_expires')) + '">') +
    (showPrices() ? field('Purchase price', '<input type="number" id="q-price" value="' + esc(v('purchase_price')) + '" min="0" step="any" inputmode="decimal" placeholder="optional">') : '') + '</div>';
  h += field('Notes', '<textarea id="q-note" maxlength="2000" placeholder="How to use it, quirks, where the spare is…">' + esc(v('note')) + '</textarea>');
  h += '<div class="sheet-actions"><button class="primary" data-act="eqformsave" data-id="' + esc(id || '') + '">Save</button>' +
    (e ? '<button data-act="eqarchive" data-id="' + e.id + '">Archive</button><button data-eq="' + e.id + '">Back</button>' : '<button data-act="close">Cancel</button>') + '</div></div>';
  openSheet(h, 'equipform', id);
}

// ---- schedules -------------------------------------------------------------
async function sheetSched(id) {
  const s = findSched(id);
  if (!s) return;
  const eq = s.equipment_id ? findEquip(s.equipment_id) : null;
  openSheet(sheetHead(s.task) + '<p class="empty">Loading…</p>', 'sched', id);
  let done = [];
  try { done = await loadCompletions(id); } catch (e) { toast(e.message, true); }
  if (SHEET.type !== 'sched' || SHEET.id !== id) return;
  let h = sheetHead(s.task) + '<div class="sbody">';
  h += '<div class="pad top"><p class="sheet-title">' + esc(dueLabel(s.next_due_at)) + '</p><div class="c-tags">' + tag(isOverdue(s) ? 'urgent' : 'sched', cap(everyLabel(s.interval_months))) +
    tag('neutral', areaName(s.area_id)) + '</div>' +
    (eq ? '<p class="desc">Generated from <button class="linklike" data-eq="' + eq.id + '">🧰 ' + esc(eq.name) + '</button> — change the interval on the equipment itself.</p>' : '') +
    (s.note ? '<p class="desc">' + esc(s.note) + '</p>' : '') +
    (s.last_completed_at ? '<p class="desc">Last done ' + esc(fmtDate(s.last_completed_at)) + '.</p>' : '') + '</div>';
  h += '<div class="boxed"><div class="hdr"><h4>MATERIALS TO BUY FIRST</h4><button data-act="additem" data-for-sched="' + s.id + '">Add</button></div>';
  if (!(s.items || []).length) h += '<div class="nt"><small>Nothing needed.</small></div>';
  for (const it of s.items || []) h += itemRowHTML(it);
  h += '</div>';
  h += '<div class="boxed"><div class="hdr"><h4>DONE BEFORE</h4></div>';
  if (!done.length) h += '<div class="nt"><small>Never logged yet.</small></div>';
  for (const c of done) h += '<div class="nt"><p>' + esc(c.completed_by_name) + ' · ' + esc(fmtDate(c.completed_at)) + '</p>' + (c.note ? '<small>' + esc(c.note) + '</small>' : '') + '</div>';
  h += '</div>';
  h += '<div class="sheet-actions"><button class="primary" data-act="schdone" data-id="' + s.id + '">Mark done today</button>' +
    (isManager() && !eq ? '<button data-act="schedit" data-id="' + s.id + '">Edit</button>' : '') + '<button data-act="close">Close</button></div></div>';
  openSheet(h, 'sched', id);
}

function sheetSchedDone(id) {
  const s = findSched(id);
  if (!s) return;
  let h = sheetHead('Done: ' + s.task) + '<div class="sbody">';
  h += field('Anything to note?', '<textarea id="sd-note" maxlength="2000" placeholder="What was done, what to watch next time…"></textarea>',
    'Logs today as done and moves the next date to ' + esc(fmtDate(addMonthsStr(todayStr(), s.interval_months))) + '.');
  h += '<div class="sheet-actions"><button class="primary" data-act="saveschdone" data-id="' + s.id + '">Log it</button><button data-sched="' + s.id + '">Back</button></div></div>';
  openSheet(h, 'scheddone', id);
}
function addMonthsStr(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function sheetSchedForm(id) {
  const s = id ? findSched(id) : null;
  let h = sheetHead(s ? 'Edit schedule' : 'Add a schedule') + '<div class="sbody">';
  h += field('Task', '<input id="sc-task" maxlength="200" value="' + esc(s ? s.task : '') + '" placeholder="e.g. Aircon clean — all Wing rooms">');
  h += field('Where', areaSelect('sc-area', s ? s.area_id : (activeAreas()[0] || {}).id, s ? s.area_id : null));
  h += '<div class="row2">' + field('Every (months)', '<input type="number" id="sc-int" value="' + esc(s ? s.interval_months : 3) + '" min="1" max="120" inputmode="numeric">') +
    field('Next due', '<input type="date" id="sc-due" value="' + esc(s ? s.next_due_at : addDaysStr(todayStr(), 7)) + '">') + '</div>';
  h += field('Notes', '<textarea id="sc-note" maxlength="2000" placeholder="What the job involves, who usually does it…">' + esc(s ? s.note || '' : '') + '</textarea>');
  h += '<div class="sheet-actions"><button class="primary" data-act="schedsave" data-id="' + esc(id || '') + '">Save</button>' +
    (s ? '<button data-act="schedarchive" data-id="' + s.id + '">Archive</button><button data-sched="' + s.id + '">Back</button>' : '<button data-act="close">Cancel</button>') + '</div></div>';
  openSheet(h, 'schedform', id);
}

// ---- alerts ----------------------------------------------------------------
function alertRowHTML(a) {
  const ic = a.kind === 'new' ? '🔧' : a.kind === 'good' ? '✓' : '!';
  const unread = alertUnread(a);
  return '<button class="alert' + (unread ? ' unread' : '') + '" data-alert="' + a.id + '">' +
    '<span class="aicon ' + a.kind + '">' + ic + '</span>' +
    '<span class="abody"><p>' + (a.actor_name ? '<b>' + esc(a.actor_name) + '</b> ' : '') + esc(a.text) + '</p>' +
    '<small>' + esc(a.subtext || '') + (a.subtext ? ' · ' : '') + esc(rel(a.created_at)) + '</small></span>' +
    (unread ? '<span class="aunread"></span>' : '') + '</button>';
}
function sheetAlerts() {
  const list = S.alerts;
  let h = sheetHead('Alerts') + '<div class="sbody">';
  if (!list.length) h += '<p class="empty">Nothing yet.</p>';
  else {
    const u = list.filter(alertUnread), r = list.filter((a) => !alertUnread(a));
    if (u.length) h += '<div class="boxed top"><div class="hdr"><h4>NEW</h4><button data-act="readall">Mark all read</button></div>' + u.map(alertRowHTML).join('') + '</div>';
    if (r.length) h += '<div class="boxed"><div class="hdr"><h4>EARLIER</h4></div>' + r.map(alertRowHTML).join('') + '</div>';
  }
  h += '<p class="note">Alerts appear <b>inside the app only</b> — there is no push or Telegram. Someone who does not open the app will not see them, which is why the unseen count matters.</p>';
  h += '<div class="sheet-actions"><button data-act="close">Done</button></div></div>';
  openSheet(h, 'alerts');
}

// ---- settings (owner + admins) --------------------------------------------
function roleLine(u) {
  return u.role === 'owner' ? 'Owner · manages everyone' : u.role === 'admin' ? 'Admin · manages staff and areas' : 'Staff · reports and fixes';
}
function sheetSettings() {
  const active = activeStaff(), gone = S.staff.filter((s) => !s.is_active);
  let h = sheetHead('Settings') + '<div class="sbody">';
  h += '<div class="boxed top"><div class="hdr"><h4>STAFF &amp; ACCESS</h4><button data-act="addstaff">Add</button></div>';
  if (!isOwner()) h += '<div class="nt"><small>You can add and deactivate staff. Only the owner can change roles.</small></div>';
  for (const u of active) {
    h += '<button class="srow" data-staff="' + u.id + '"><span class="av ' + esc(u.role) + '">' + esc(u.name.charAt(0)) + '</span>' +
      '<span class="sinfo"><p>' + esc(u.name) + (u.id === S.me.id ? ' <small>(you)</small>' : '') + '</p><small>' + esc(roleLine(u)) + '</small></span><span class="age">›</span></button>';
  }
  h += '</div>';
  if (gone.length) {
    h += '<div class="boxed"><div class="hdr"><h4>DEACTIVATED</h4></div>';
    for (const u of gone) h += '<button class="srow off" data-staff="' + u.id + '"><span class="av">' + esc(u.name.charAt(0)) + '</span>' +
      '<span class="sinfo"><p>' + esc(u.name) + '</p><small>Left ' + esc(fmtDate(u.deactivated_at)) + ' · still named on old work orders</small></span><span class="age">›</span></button>';
    h += '</div>';
  }
  h += '<div class="boxed"><div class="hdr"><h4>WHAT STAFF CAN SEE</h4></div>' +
    '<div class="srow static"><span class="sinfo"><p>Hide prices from staff</p><small>Shopping list still visible, prices blanked' + (isOwner() ? '' : ' · owner only') + '</small></span>' +
    '<button class="toggle' + (S.settings.hide_prices_from_staff ? ' on' : '') + '" data-act="toggleprices" aria-pressed="' + !!S.settings.hide_prices_from_staff + '"' + (isOwner() ? '' : ' disabled') + '><i></i></button></div></div>';
  h += '<div class="boxed"><div class="hdr"><h4>TIMING</h4></div>' +
    '<div class="srow static"><span class="sinfo"><p>Flag as “not started” after</p><small>Seen but untouched this long rises to the top' + (isOwner() ? '' : ' · owner only') + '</small></span>' +
    '<span class="stale"><input type="number" id="stale-days" value="' + esc(S.settings.stale_after_days) + '" min="1" max="60" inputmode="numeric"' + (isOwner() ? ' data-change="staledays"' : ' disabled') + '> days</span></div></div>';
  h += '<div class="boxed"><div class="hdr"><h4>AREAS</h4><button data-act="areas">Manage</button></div>' +
    '<button class="srow" data-act="areas"><span class="sinfo"><p>' + activeAreas().length + ' areas across ' + S.groups.length + ' groups</p><small>Archive, never delete</small></span><span class="age">›</span></button></div>';
  h += '<div class="sheet-actions"><button data-act="close">Done</button></div></div>';
  openSheet(h, 'settings');
}

function sheetStaff(id) {
  const u = S.staff.find((s) => s.id === id);
  if (!u) return;
  const target = u.role, self = u.id === S.me.id;
  let h = sheetHead(u.name) + '<div class="sbody">';
  h += '<div class="pad top who-head"><span class="av big ' + esc(u.role) + '">' + esc(u.name.charAt(0)) + '</span>' +
    '<div><p class="sheet-title">' + esc(u.name) + '</p><small>Added ' + esc(fmtDate(u.created_at)) + (u.is_active ? '' : ' · deactivated ' + esc(fmtDate(u.deactivated_at))) + '</small></div></div>';
  h += '<div class="field"><label>Role</label><div class="pills">' + ['staff', 'admin', 'owner'].map((r) => {
    const lock = target === 'owner' ? r !== 'owner' : r === 'owner';
    return '<button class="pill' + (lock || !isOwner() ? ' locked' : '') + '" data-srole="' + u.id + ':' + r + '" aria-pressed="' + (target === r) + '">' + cap(r) + '</button>';
  }).join('') + '</div>' +
    '<p class="hint">' + (target === 'owner' ? 'The owner cannot be demoted, not even by another admin. This is why Lexi can never be locked out of her own app.'
      : isOwner() ? 'Only you can promote or demote. Admins cannot change anyone’s role, including their own.'
      : 'Only the owner can promote or demote. Admins can add and deactivate staff but never change a role.') + '</p></div>';
  const perms = target === 'owner'
    ? ['Everything staff and admins can do', 'Promote staff to admin, demote an admin', 'Sole role that can change any role', 'Hide prices from staff, set timing']
    : target === 'admin'
    ? ['Everything staff can do', 'Add and deactivate staff', 'Manage areas, equipment and schedules', 'Reset a staff PIN']
    : ['Report issues and add photos', 'Update status and take on work', 'Add items to the shopping list', 'Update equipment condition and stock'];
  h += '<div class="boxed"><div class="hdr"><h4>CAN DO</h4></div>' + perms.map((x) => '<div class="nt slim"><p>' + esc(x) + '</p></div>').join('') + '</div>';
  const canResetPin = self || (isOwner()) || (isManager() && target === 'staff');
  h += '<div class="boxed"><div class="hdr"><h4>PIN</h4></div><div class="srow static"><span class="sinfo"><p>4-digit PIN</p><small>Nobody can read it — only set a new one</small></span>' +
    (canResetPin && u.is_active ? '<button class="sbtn" data-act="resetpin" data-id="' + u.id + '">Reset</button>' : '') + '</div></div>';
  const canDeact = !self && target !== 'owner' && (isOwner() || target === 'staff');
  if (canDeact) {
    h += '<div class="boxed"><div class="hdr"><h4>REMOVE</h4></div>' +
      '<div class="srow static"><span class="sinfo"><p>Deactivate</p><small>Keeps them on the list, greyed out. Can be undone.</small></span>' +
      (u.is_active ? '<button class="sbtn" data-act="deact" data-id="' + u.id + '">Deactivate</button>' : '<button class="sbtn" data-act="react" data-id="' + u.id + '">Reactivate</button>') + '</div>' +
      '<div class="srow static"><span class="sinfo"><p>Delete</p><small>Takes them off the list for good. Anything they logged keeps their name.</small></span>' +
      '<button class="sbtn danger" data-act="delstaff" data-id="' + u.id + '">Delete</button></div></div>';
  }
  h += '<div class="sheet-actions">';
  if (target === 'owner') h += '<button disabled>Cannot remove the owner</button>';
  h += '<button class="primary" data-act="settings">' + (target === 'owner' ? 'Done' : 'Back') + '</button>';
  h += '</div></div>';
  openSheet(h, 'staff', id);
}

function sheetAddStaff() {
  let h = sheetHead('Add a person') + '<div class="sbody">';
  h += field('Name', '<input id="ns-name" maxlength="60" placeholder="How they appear on the login list" autocomplete="off">');
  h += field('Role', pills('ns-role', [{ value: 'staff', label: 'Staff' }, { value: 'admin', label: 'Admin' }], 'staff', 'nsrole'),
    isOwner() ? 'Admins manage staff, areas, equipment and schedules.' : 'Only the owner can create an admin — you can add them as staff.');
  h += field('Starting PIN', '<input id="ns-pin" maxlength="4" inputmode="numeric" pattern="[0-9]*" placeholder="4 digits" autocomplete="off">',
    'They can change it themselves after first login. It is stored hashed, never as typed.');
  h += '<div class="sheet-actions"><button class="primary" data-act="savestaff">Add</button><button data-act="settings">Cancel</button></div></div>';
  openSheet(h, 'addstaff');
}

// Set a new PIN — for yourself (anyone) or for someone else (managers).
function sheetPin(staffId) {
  const u = staffId ? S.staff.find((s) => s.id === staffId) : S.me;
  const self = !staffId || staffId === S.me.id;
  let h = sheetHead(self ? 'Change my PIN' : 'Reset PIN for ' + (u ? u.name : '')) + '<div class="sbody">';
  h += field('New 4-digit PIN', '<input id="pin-new" type="password" maxlength="4" inputmode="numeric" pattern="[0-9]*" placeholder="• • • •" autocomplete="new-password">');
  h += field('Again', '<input id="pin-again" type="password" maxlength="4" inputmode="numeric" pattern="[0-9]*" placeholder="• • • •" autocomplete="new-password">',
    self ? 'The old one is never shown to anyone — not even you.' : 'Tell them the new PIN in person. The old one stops working immediately.');
  h += '<div class="sheet-actions"><button class="primary" data-act="savepin" data-id="' + esc(staffId || '') + '">Save</button>' +
    '<button data-act="' + (self ? 'me' : 'staffback') + '" data-id="' + esc(staffId || '') + '">Back</button></div></div>';
  openSheet(h, 'pin', staffId);
}

function sheetMe() {
  let h = sheetHead(S.me.name) + '<div class="sbody">';
  h += '<div class="boxed top">' +
    '<button class="srow" data-act="changepin"><span class="sinfo"><p>Change my PIN</p><small>4 digits · nobody else can see it</small></span><span class="age">›</span></button>' +
    '<a class="srow" href="' + esc(S.me.role === 'staff' ? HUB_STAFF_URL : HUB_URL) + '"><span class="sinfo"><p>⌂ Tanawin Hub</p><small>The other apps</small></span><span class="age">›</span></a>' +
    '</div>';
  h += '<p class="note">Signed in as <b>' + esc(S.me.name) + '</b> · ' + esc(cap(S.me.role)) + '. You stay signed in on this phone until you log out.</p>';
  h += '<div class="sheet-actions"><button data-act="logout">Log out</button><button class="primary" data-act="close">Done</button></div></div>';
  openSheet(h, 'me');
}

// ---- areas -----------------------------------------------------------------
function sheetAreas() {
  let h = sheetHead('Areas') + '<div class="sbody">';
  for (const g of S.groups) {
    h += '<div class="boxed' + (g === S.groups[0] ? ' top' : '') + '"><div class="hdr"><h4>' + esc(g.name.toUpperCase()) + (g.blocks_booking ? ' · BLOCKS BOOKING' : '') + '</h4><button data-act="addarea" data-id="' + g.id + '">Add</button></div>';
    for (const a of S.areas.filter((x) => x.group_id === g.id)) {
      const n = openIssues().filter((i) => i.area_id === a.id).length;
      h += '<button class="srow' + (a.archived_at ? ' off' : '') + '" data-area="' + a.id + '"><span class="sinfo"><p>' + esc(a.name) + '</p>' +
        '<small>' + (a.archived_at ? 'archived' : n ? n + ' open issue' + (n > 1 ? 's' : '') : '') + '</small></span><span class="age">edit</span></button>';
    }
    h += '</div>';
  }
  h += '<p class="note">Areas are <b>archived, never deleted</b>, so a work order from three years ago still resolves to a real place.</p>';
  h += '<div class="sheet-actions"><button data-act="settings">Back</button></div></div>';
  openSheet(h, 'areas');
}
function sheetAreaForm(areaId, groupId) {
  const a = areaId ? areaById(areaId) : null;
  let h = sheetHead(a ? 'Edit area' : 'Add an area') + '<div class="sbody">';
  h += field('Name', '<input id="ar-name" maxlength="80" value="' + esc(a ? a.name : '') + '" placeholder="e.g. Annex Room 2">');
  h += field('Group', '<select id="ar-group">' + S.groups.map((g) => '<option value="' + g.id + '"' + (g.id === (a ? a.group_id : groupId) ? ' selected' : '') + '>' + esc(g.name) + (g.blocks_booking ? ' (blocks booking)' : '') + '</option>').join('') + '</select>',
    'Whether an open repair means the place should not be booked comes from the group, not the area.');
  h += '<div class="sheet-actions"><button class="primary" data-act="areasave" data-id="' + esc(areaId || '') + '">Save</button>' +
    (a ? '<button data-act="areaarchive" data-id="' + a.id + '">' + (a.archived_at ? 'Unarchive' : 'Archive') + '</button>' : '') +
    '<button data-act="areas">Back</button></div></div>';
  openSheet(h, 'areaform', areaId);
}

// ---- generic text ------------------------------------------------------------
function sheetText(title, label, placeholder, act, id, value, backAttr) {
  let h = sheetHead(title) + '<div class="sbody">';
  h += field(label, '<textarea id="t-val" maxlength="4000" placeholder="' + esc(placeholder) + '">' + esc(value || '') + '</textarea>');
  h += '<div class="sheet-actions"><button class="primary" data-act="' + act + '" data-id="' + esc(id || '') + '">Save</button>' +
    '<button ' + backAttr + '>Back</button></div></div>';
  openSheet(h, 'text', id);
}

// ---- archive month ---------------------------------------------------------
function sheetArchiveMonth(ym) {
  const A = S.archive;
  let h = sheetHead(fmtMonth(ym)) + '<div class="sbody">';
  if (A.loading) { h += '<p class="empty">Loading…</p></div>'; return openSheet(h, 'month', ym); }
  const rows = A.rows.filter((i) => (!A.area || i.area_id === A.area) && (!A.cat || i.category === A.cat));
  const areasIn = S.areas.filter((a) => A.rows.some((i) => i.area_id === a.id));
  const catsIn = CATEGORIES.filter((c) => A.rows.some((i) => i.category === c));
  h += '<div class="filters top"><select data-change="archarea"><option value="">All areas</option>' + areasIn.map((a) => '<option value="' + a.id + '"' + (A.area === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>').join('') + '</select>' +
    '<select data-change="archcat"><option value="">All categories</option>' + catsIn.map((c) => '<option' + (A.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select></div>';
  h += '<p class="sect">' + rows.length + ' fixed' + (rows.length !== A.rows.length ? ' of ' + A.rows.length : '') + '</p>';
  for (const i of rows) {
    h += '<button class="row" data-issue="' + i.id + '"><span class="state fix">3</span><span class="rbody"><p>' + esc(i.title) + '</p><small>' +
      esc(areaName(i.area_id)) + ' · ' + esc(i.category) + ' · ' + esc(i.completed_by_name || '') + '</small></span><span class="age">' + esc(fmtDate(i.completed_at)) + '</span></button>';
  }
  if (!rows.length) h += '<p class="empty">Nothing matches.</p>';
  h += '<div class="sheet-actions"><a class="btn" href="print.html?month=' + esc(ym) + '" target="_blank" rel="noopener">Print view</a><button data-act="close">Close</button></div></div>';
  openSheet(h, 'month', ym);
}

// ---- photo lightbox ----------------------------------------------------------
function showPhoto(path) {
  const url = signedUrl(path);
  if (!url) return toast('Photo link expired — reopen the work order', true);
  const box = $('lightbox');
  box.innerHTML = '';
  const img = document.createElement('img');
  img.src = url; img.alt = '';
  box.appendChild(img);
  box.className = 'lightbox on';
}
