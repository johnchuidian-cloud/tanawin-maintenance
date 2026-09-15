// Tanawin Maintenance — page renderers (the five tabs). Pure functions of S
// that return HTML strings; app.js swaps them into #page. Bottom sheets live
// in sheets.js. Every dynamic string passes through esc().
'use strict';

function tag(cls, label) { return '<span class="tag ' + cls + '">' + esc(label) + '</span>'; }
function prioTag(p) { return tag(p, cap(p)); }

// ---- bottom nav ------------------------------------------------------------
function navHTML() {
  const tabs = [['issues', '🔧', 'Issues'], ['equip', '🧰', 'Equipment'], ['sched', '🗓', 'Scheduled'], ['shop', '🛒', 'Shopping'], ['archive', '🗄', 'Archive']];
  const badges = { issues: S.me.role === 'owner' ? unseenIssues().length : triageQueue().length, shop: shopOutstanding() };
  return tabs.map(([k, ic, label]) =>
    '<button data-page="' + k + '" aria-pressed="' + (S.page === k) + '">' +
    (badges[k] ? '<span class="bdg">' + badges[k] + '</span>' : '') +
    '<span class="ic">' + ic + '</span>' + label + '</button>').join('');
}

// ---- the three-dot stage rail ---------------------------------------------
function railHTML(i) {
  const st = stage(i), u = i.priority === 'urgent' && st === 1, g = st === 3;
  const d = (n) => '<span class="dot' + (st >= n ? ' on' : '') + (st >= n && u && n === 1 ? ' u' : '') + (g ? ' g' : '') + '"></span>';
  const l = (n) => '<span class="ln' + (st > n ? ' on' : '') + (g ? ' g' : '') + '"></span>';
  return '<div class="rail">' + d(1) + l(1) + d(2) + l(2) + d(3) + '</div>';
}
function railLabel(i) {
  if (i.completed_at) return '<p class="rlab"><b>Fixed</b><span>' + esc(rel(i.completed_at)) + ' · ' + esc(i.completed_by_name || '') + '</span></p>';
  if (i.started_at) return '<p class="rlab"><b>In progress</b><span>Started ' + esc(rel(i.started_at)) + '</span></p>';
  if (!i.acknowledged_at) return '<p class="rlab"><b>Posted by ' + esc(i.reported_by_name) + '</b><span class="warn">' + esc(rel(i.reported_at)) + ' · unseen</span></p>';
  const stalled = isStalled(i);
  return '<p class="rlab"><b>Reported</b><span' + (stalled ? ' class="warn"' : '') + '>' + esc(rel(i.reported_at)) + (stalled ? ', not started' : '') + '</span></p>';
}

function cardHTML(i) {
  const cls = i.completed_at ? 'done' : !i.acknowledged_at ? 'n' : i.priority === 'urgent' ? 'u' : '';
  const m = [];
  if (i.photo_count) m.push('📷 ' + i.photo_count);
  const need = unacquired(i).length;
  if (need) m.push('🛒 ' + need + (need === 1 ? ' item' : ' items'));
  if (i.reopened_count) m.push('↩ reopened ' + i.reopened_count + '×');
  m.push(i.assigned_to_name || 'Unassigned');
  const blocks = groupOfArea(i.area_id).blocks_booking && !i.completed_at;
  return '<button class="card ' + cls + '" data-issue="' + i.id + '">' +
    '<div class="ctop"><div><p class="where">' + esc(areaName(i.area_id)) + ' · ' + esc(i.category) + '</p>' +
    '<p class="what">' + esc(i.title) + '</p></div>' + prioTag(i.priority) + '</div>' +
    railHTML(i) + railLabel(i) +
    '<div class="meta">' + m.map((x) => '<span>' + esc(x) + '</span>').join('') + '</div>' +
    (blocks ? '<span class="flag">Room should not be booked</span>' : '') +
    '</button>';
}

// ---- the collapsed by-area list (one component, both roles) ---------------
function byAreaHTML() {
  const open = openIssues();
  const groupsWithWork = S.groups.filter((g) => open.some((i) => groupOfArea(i.area_id).id === g.id));
  let out = '<div class="exp' + (S.expOpen ? ' open' : '') + '" id="exp">' +
    '<button class="exp-btn" data-act="exp"><span>Everything open <small>· ' + open.length + ' across ' + groupsWithWork.length +
    (groupsWithWork.length === 1 ? ' area group' : ' area groups') + '</small></span><span class="arrow">▼</span></button>' +
    '<div class="exp-body">' +
    '<input class="srch" id="srch" type="search" placeholder="Search area or problem…" value="' + esc(S.search) + '" autocomplete="off">' +
    '<div id="exp-rows">' + byAreaRowsHTML() + '</div></div></div>';
  return out;
}
function byAreaRowsHTML() {
  const q = nameKey(S.search);
  const match = (text) => !q || nameKey(text).includes(q);
  let out = '';
  for (const g of S.groups) {
    const rows = openIssues().filter((i) => groupOfArea(i.area_id).id === g.id && match(i.title + ' ' + areaName(i.area_id) + ' ' + i.category));
    const scs = S.schedules.filter((s) => groupOfArea(s.area_id).id === g.id && isDueSoon(s) && match(s.task + ' ' + areaName(s.area_id)));
    if (!rows.length && !scs.length) continue;
    const u = rows.filter(isUnseen).length;
    out += '<div class="areahd"><h3>' + esc(g.name) + '</h3><span>' + (u ? '<b>' + u + ' unseen</b> · ' : '') + rows.length + ' open</span></div>';
    for (const i of rows) {
      const st = stage(i), need = unacquired(i).length;
      out += '<button class="row' + (isUnseen(i) ? ' n' : '') + '" data-issue="' + i.id + '">' +
        '<span class="state ' + (st === 2 ? 'prog' : 'rep') + '">' + (isUnseen(i) ? '!' : st) + '</span>' +
        '<span class="rbody"><p>' + esc(i.title) + '</p><small>' + esc(areaName(i.area_id)) + ' · ' + esc(i.assigned_to_name || 'unassigned') +
        (need ? ' · 🛒 ' + need : '') + '</small></span>' +
        '<span class="age' + (isUnseen(i) || isStalled(i) ? ' warn' : '') + '">' + (isUnseen(i) ? 'unseen' : esc(relShort(i.reported_at))) + '</span></button>';
    }
    for (const s of scs) {
      out += '<button class="row" data-sched="' + s.id + '"><span class="state due">🗓</span>' +
        '<span class="rbody"><p>' + esc(s.task) + '</p><small>' + esc(areaName(s.area_id)) + ' · ' + esc(everyLabel(s.interval_months)) + '</small></span>' +
        '<span class="age' + (isOverdue(s) ? ' warn' : '') + '">' + esc(dueParts(s.next_due_at).big) + '</span></button>';
    }
  }
  if (!out) out = '<p class="empty">' + (q ? 'Nothing matches.' : 'Nothing open anywhere.') + '</p>';
  return out;
}

// ---- Issues tab ------------------------------------------------------------
function pageIssues() {
  if (S.me.role !== 'owner') return triageHTML() + byAreaHTML() + '<button class="cta" data-act="report">Report an issue</button>';
  return overviewHTML() + byAreaHTML() + '<button class="cta" data-act="report">Report an issue</button>';
}

function triageHTML() {
  const q = triageQueue();
  if (S.triage >= q.length) S.triage = 0;
  const cur = q[S.triage];
  if (!cur) {
    return '<div class="c-head"><p>Nothing waiting</p><h2>All picked up</h2></div>' +
      '<p class="empty">Every open issue has someone on it.<br>Everything else is below.</p>';
  }
  const need = unacquired(cur).length;
  const mine = cur.assigned_to_id === S.me.id;
  return '<div class="c-head"><p>' + (mine ? 'Assigned to you, not yet seen' : 'Needs someone to look at it') + '</p><h2>' + (S.triage + 1) + ' of ' + q.length + '</h2></div>' +
    '<div class="c-card" data-issue="' + cur.id + '"><div class="c-photo" id="triage-photo" data-photo-issue="' + cur.id + '">' + (cur.photo_count ? '📷' : '🔧') + '</div><div class="c-body">' +
    '<p class="c-where">' + esc(areaName(cur.area_id)) + '</p><p class="c-what">' + esc(cur.title) + '</p>' +
    '<div class="c-tags">' + prioTag(cur.priority) + tag('neutral', cur.category) + (cur.reopened_count ? tag('neutral', 'Reopened ' + cur.reopened_count + '×') : '') + '</div>' +
    '<div class="c-line"><span>Posted by</span><span>' + esc(cur.reported_by_name) + ' · ' + esc(rel(cur.reported_at)) + '</span></div>' +
    '<div class="c-line"><span>Seen by</span><span' + (cur.acknowledged_at ? '' : ' class="warn"') + '>' + (cur.acknowledged_at ? esc(cur.acknowledged_by_name) : 'Nobody yet') + '</span></div>' +
    (need ? '<div class="c-line"><span>Needs buying</span><span>' + need + (need === 1 ? ' item' : ' items') + '</span></div>' : '') +
    '<div class="c-line"><span>Tap for full detail</span><span>›</span></div>' +
    '</div></div>' +
    '<div class="c-actions"><button data-act="skip">Skip</button>' +
    '<button class="primary" data-act="take" data-id="' + cur.id + '">' + (mine ? "I've seen this" : "I'll take this") + '</button></div>' +
    '<p class="c-pager">' + (q.length > 1 ? 'Skip to see the next one' : 'This is the only one waiting') + '</p>';
}

function overviewHTML() {
  const f = S.scoreFilter;
  const open = openIssues();
  let o = '<div class="scores">' +
    '<button class="score u" data-score="unseen" aria-pressed="' + (f === 'unseen') + '"><b>' + unseenIssues().length + '</b><i>Not yet seen</i></button>' +
    '<button class="score d" data-score="attn" aria-pressed="' + (f === 'attn') + '"><b>' + open.filter(needsAttention).length + '</b><i>Needs attention</i></button>' +
    '<button class="score" data-score="all" aria-pressed="' + (f === 'all') + '"><b>' + open.length + '</b><i>All open</i></button>' +
    '</div><div class="list">';
  if (f === 'attn') {
    const list = open.filter(needsAttention);
    o += '<p class="sect">Needs attention</p>' + (list.length ? list.map(cardHTML).join('') : '<p class="empty">Nothing urgent or stalled.</p>');
  } else {
    const un = open.filter(isUnseen);
    const att = open.filter(needsAttention);
    const rest = open.filter((i) => !isUnseen(i) && !needsAttention(i));
    const fx = fixedRecently();
    if (un.length) o += '<p class="sect">Not yet seen by anyone</p>' + un.map(cardHTML).join('');
    if (att.length) o += '<p class="sect">Needs attention</p>' + att.map(cardHTML).join('');
    if (rest.length) o += '<p class="sect">Open</p>' + rest.map(cardHTML).join('');
    if (!open.length) o += '<p class="empty">Nothing open. Enjoy it.</p>';
    if (fx.length) o += '<p class="sect">Fixed this week</p>' + fx.map(cardHTML).join('');
  }
  return o + '</div>';
}

// ---- Equipment tab ---------------------------------------------------------
function equipStatus(e) {
  const c = equipCondition(e);
  if (c === 'broken') return tag('broken', 'Broken');
  if (c === 'service due') return tag('service', 'Service due');
  if (isLow(e)) return tag('service', 'Low stock');
  return tag('ok', e.category === 'Consumables' ? 'In stock' : 'Working');
}
const equipAlert = (e) => equipCondition(e) !== 'working' || isLow(e);

function pageEquip() {
  const cats = ['All', 'Needs attention', ...EQUIPMENT_CATEGORIES];
  const list = S.equipment.filter((e) => S.eqFilter === 'All' ? true : S.eqFilter === 'Needs attention' ? equipAlert(e) : e.category === S.eqFilter);
  const bad = S.equipment.filter((e) => equipCondition(e) !== 'working').length;
  const low = S.equipment.filter(isLow).length;
  let o = '<div class="hd"><h2>Equipment</h2><p>' + S.equipment.length + (S.equipment.length === 1 ? ' item' : ' items') +
    (bad ? ' · <b>' + bad + ' need' + (bad === 1 ? 's' : '') + ' attention</b>' : '') + (low ? ' · ' + low + ' low stock' : '') + '</p></div>' +
    '<div class="chips">' + cats.map((c) => '<button class="chip" data-eqf="' + esc(c) + '" aria-pressed="' + (S.eqFilter === c) + '">' + esc(c) + '</button>').join('') + '</div>' +
    '<div class="grid">';
  for (const e of list) {
    const url = e.photo_path ? signedUrl(e.photo_path) : '';
    o += '<button class="ecard' + (equipAlert(e) ? ' attn' : '') + '" data-eq="' + e.id + '">' +
      '<span class="eimg">' + (url ? '<img src="' + esc(url) + '" alt="">' : '<span class="noimg">📷</span>') + '</span><span class="ebody">' +
      '<p class="ename">' + esc(e.name) + '</p><p class="ewhere">' + esc(areaName(e.area_id)) + '</p>' +
      '<span class="efoot">' + equipStatus(e) + '<span class="eqty">' + esc(Number(e.qty)) + (e.unit ? ' ' + esc(e.unit) : '') + '</span></span>' +
      '</span></button>';
  }
  o += '</div>';
  if (!list.length) o += '<p class="empty">' + (S.equipment.length ? 'Nothing in this filter.' : 'No equipment listed yet.') + '</p>';
  o += '<p class="note">Photos exist so anyone can <b>identify a tool they have never used</b>, and so condition is visible without walking to the stock room. Items with a service interval feed <b>Scheduled</b> automatically.</p>';
  if (isManager()) o += '<button class="cta" data-act="addeq">Add equipment</button>';
  return o;
}

// ---- Scheduled tab ---------------------------------------------------------
function schedRowHTML(s, cls) {
  const need = (s.items || []).filter((it) => !it.acquired).length;
  const p = dueParts(s.next_due_at);
  const eq = s.equipment_id ? findEquip(s.equipment_id) : null;
  return '<div class="row' + (cls || '') + '"><button class="swhen" data-sched="' + s.id + '"><b>' + esc(p.big) + '</b><small>' + esc(p.small) + '</small></button>' +
    '<button class="rbody" data-sched="' + s.id + '"><p>' + esc(s.task) + '</p><small>' + esc(areaName(s.area_id)) + ' · ' + esc(everyLabel(s.interval_months)) +
    (eq ? ' · from ' + esc(eq.name) : '') + (need ? ' · 🛒 ' + need : '') + '</small></button>' +
    '<button class="sbtn" data-act="schdone" data-id="' + s.id + '">Done</button></div>';
}
function pageSched() {
  const due = S.schedules.filter(isDueSoon);
  const later = S.schedules.filter((s) => !isDueSoon(s));
  let o = '<div class="hd"><h2>Scheduled</h2><p>Recurring maintenance' + (due.length ? ' · <b>' + due.length + ' due this week</b>' : '') + '</p></div>';
  if (due.length) o += '<p class="sect">This week</p>' + due.map((s) => schedRowHTML(s, ' due')).join('');
  if (later.length) o += '<p class="sect">Coming up</p>' + later.map((s) => schedRowHTML(s)).join('');
  if (!S.schedules.length) o += '<p class="empty">No recurring tasks yet.</p>';
  o += '<p class="note">Entries marked <b>from</b> came from an equipment service interval — not a separate list to maintain. Tap a task for its history and materials.</p>';
  if (isManager()) o += '<button class="cta" data-act="addsched">Add a schedule</button>';
  return o;
}

// ---- Shopping tab ----------------------------------------------------------
function pageShop() {
  const all = shoppingRows();
  const areaFilter = S.shopArea;
  const rows = areaFilter ? all.filter((r) => r.area_ids.has(areaFilter)) : all;
  const groups = [['repairs', 'For open repairs'], ['sched', 'For scheduled maintenance'], ['low', 'Low stock']];
  const prices = showPrices();
  let out = 0, est = 0, estMissing = 0;
  for (const r of rows) if (!r.acquired) { out++; if (r.est != null) est += r.est * r.qty; else estMissing++; }
  let o = '<div class="hd"><h2>Shopping list</h2><p>' + out + ' still needed · across all work orders</p></div>';
  const areasInList = activeAreas().filter((a) => all.some((r) => r.area_ids.has(a.id)));
  if (areasInList.length > 1) {
    o += '<div class="filters"><select id="shop-area" data-change="shoparea"><option value="">All areas</option>' +
      areasInList.map((a) => '<option value="' + a.id + '"' + (areaFilter === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>').join('') + '</select></div>';
  }
  for (const [g, label] of groups) {
    const rs = rows.filter((r) => r.group === g).sort((a, b) => (a.acquired - b.acquired) || a.name.localeCompare(b.name));
    if (!rs.length) continue;
    o += '<p class="sect">' + label + '</p>';
    for (const r of rs) {
      const price = r.acquired ? (r.actual != null ? peso(r.actual * r.qty) : '—') : (r.est != null ? peso(r.est * r.qty) : '—');
      const plabel = r.acquired ? 'paid' : (r.est != null ? 'estimate' : 'no estimate');
      const key = esc(r.key);
      o += '<div class="shrow' + (r.acquired ? ' got' : '') + '">' +
        '<button class="box" data-tick="' + key + '" aria-label="' + (r.acquired ? 'Untick' : 'Mark as bought') + '">' + (r.acquired ? '✓' : '') + '</button>' +
        '<button class="shbody" data-shop="' + key + '"><p>' + esc(r.name) + (r.qty > 1 ? ' ×' + esc(Number(r.qty)) + (r.unit ? ' ' + esc(r.unit) : '') : '') + '</p>' +
        r.sources.slice(0, 3).map((s) => '<small>' + esc(s) + '</small>').join('') + (r.sources.length > 3 ? '<small>+' + (r.sources.length - 3) + ' more</small>' : '') +
        (r.note.length ? '<small class="note">' + esc(r.note[0]) + '</small>' : '') + '</button>' +
        (prices ? '<button class="shprice" data-shop="' + key + '">' + price + '<small>' + plabel + '</small></button>' : '') +
        '</div>';
    }
  }
  if (!rows.length) o += '<p class="empty">Nothing on the list.</p>';
  if (prices && out) o += '<div class="total"><span>Still to buy<small>estimates' + (estMissing ? ' · ' + estMissing + ' without one' : '') + '</small></span><span>' + peso(est) + '</span></div>';
  o += '<p class="note">Ticking an item asks what you <b>actually paid</b>, so the app remembers the price and the shop for next time. <b>Expenses still get logged in Finance</b> — this is a shopping list, not an accounting record.</p>';
  return o + '<button class="cta" data-act="additem">Add an item</button>';
}

// ---- Archive tab -----------------------------------------------------------
function pageArchive() {
  let o = '<div class="hd"><h2>Archive</h2><p>Everything fixed, by month</p></div>';
  const m = S.archive.months;
  if (m === null) o += '<p class="empty">Loading…</p>';
  else if (!m.length) o += '<p class="empty">Nothing fixed yet. The first fixed work order starts the archive.</p>';
  else {
    let year = '';
    for (const row of m) {
      const y = row.month.slice(0, 4);
      if (y !== year) { year = y; o += '<p class="sect">' + esc(y) + '</p>'; }
      o += '<button class="krow" data-month="' + esc(row.month) + '"><div><p>' + esc(fmtMonth(row.month).replace(' ' + y, '')) + '</p><small>' +
        row.fixed + ' fixed · ' + row.areas + (row.areas === 1 ? ' area' : ' areas') + '</small></div><span class="kamt">›</span></button>';
    }
  }
  o += '<p class="note">Nothing is ever deleted. The archive is a view, searchable by area, category and month. <b>Spending lives in Finance</b>, not here.</p>';
  return o;
}
