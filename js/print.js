// Print view: every work order fixed in ?month=YYYY-MM, as a table. Reuses
// the app's signed-in session (same origin, same localStorage) and reads by
// month in pages of 200 on a unique order, like the app does.
'use strict';

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const doc = document.getElementById('doc');
document.getElementById('printBtn').onclick = () => window.print();

function text(tag, content, cls) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  el.textContent = content;
  return el;
}

(async function main() {
  const ym = new URLSearchParams(location.search).get('month');
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) { doc.replaceChildren(text('p', 'No month given.', 'muted')); return; }
  const { data: { session } } = await db.auth.getSession();
  if (!session) { doc.replaceChildren(text('p', 'Sign in to the app first, then open this page again.', 'muted')); return; }

  const { start, end } = monthRange(ym);
  const areas = (await db.from('areas').select('id, name')).data || [];
  const areaName = (id) => (areas.find((a) => a.id === id) || {}).name || 'Unknown area';
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db.from('issues')
      .select('id, area_id, title, category, priority, reported_by_name, reported_at, completed_at, completed_by_name, assigned_to_name, resolution_note, vendor_contact, reopened_count, items(name, qty, unit, acquired)')
      .gte('completed_at', start).lt('completed_at', end)
      .order('completed_at').order('id').range(from, from + 199);
    if (error) { doc.replaceChildren(text('p', 'Could not load: ' + error.message, 'muted')); return; }
    rows.push(...(data || []));
    if (!data || data.length < 200) break;
    from += 200;
  }

  const frag = document.createDocumentFragment();
  frag.appendChild(text('h1', 'Tanawin Bed & Breakfast — maintenance record, ' + fmtMonth(ym)));
  frag.appendChild(text('p', rows.length + (rows.length === 1 ? ' work order fixed' : ' work orders fixed') + ' · printed ' + fmtDate(new Date().toISOString()), 'sub'));
  if (!rows.length) { frag.appendChild(text('p', 'Nothing was fixed this month.', 'muted')); doc.replaceChildren(frag); return; }

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const h of ['Fixed', 'Area', 'Problem', 'Reported', 'Done by', 'Materials']) hr.appendChild(text('th', h));
  thead.appendChild(hr); table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const i of rows) {
    const tr = document.createElement('tr');
    tr.appendChild(text('td', fmtDate(i.completed_at)));
    tr.appendChild(text('td', areaName(i.area_id)));
    const prob = document.createElement('td');
    prob.appendChild(document.createTextNode(i.title));
    const meta = [i.category, i.priority].concat(i.reopened_count ? ['reopened ' + i.reopened_count + '×'] : []).join(' · ');
    prob.appendChild(text('small', meta));
    if (i.resolution_note) prob.appendChild(text('small', i.resolution_note));
    tr.appendChild(prob);
    const rep = document.createElement('td');
    rep.appendChild(document.createTextNode(i.reported_by_name));
    rep.appendChild(text('small', fmtDate(i.reported_at)));
    tr.appendChild(rep);
    const by = document.createElement('td');
    by.appendChild(document.createTextNode(i.completed_by_name || i.assigned_to_name || ''));
    if (i.vendor_contact) by.appendChild(text('small', i.vendor_contact));
    tr.appendChild(by);
    const mat = document.createElement('td');
    const bought = (i.items || []).filter((it) => it.acquired);
    if (bought.length) {
      const ul = document.createElement('ul'); ul.className = 'items';
      for (const it of bought) ul.appendChild(text('li', it.name + (Number(it.qty) > 1 ? ' ×' + Number(it.qty) : '') + (it.unit ? ' ' + it.unit : '')));
      mat.appendChild(ul);
    } else mat.appendChild(text('small', '—'));
    tr.appendChild(mat);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  frag.appendChild(table);
  frag.appendChild(text('p', 'Materials are listed for the record only. Spending is in Tanawin Finance.', 'foot'));
  doc.replaceChildren(frag);
})();
