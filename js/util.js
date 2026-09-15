// Tanawin Maintenance — small helpers shared by every other file.
// Classic script (no modules): everything here is a global on purpose.
'use strict';

const $ = (id) => document.getElementById(id);

function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function peso(n) {
  const v = Number(n || 0);
  return '₱' + v.toLocaleString('en-PH', { maximumFractionDigits: v % 1 ? 2 : 0 });
}

function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

function toast(msg, isError) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast on' + (isError ? ' err' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast'; }, isError ? 3200 : 1800);
}

// ---- time ------------------------------------------------------------------
const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ageMs(ts) { return ts ? Date.now() - new Date(ts).getTime() : 0; }
function daysOld(ts) { return Math.floor(ageMs(ts) / DAY); }

// "just now", "35 min ago", "2 hours ago", "6 days ago", "12 Aug"
function rel(ts) {
  if (!ts) return '';
  const ms = ageMs(ts);
  if (ms < MIN) return 'just now';
  if (ms < HOUR) return Math.floor(ms / MIN) + ' min ago';
  if (ms < DAY) { const h = Math.floor(ms / HOUR); return h + (h === 1 ? ' hour ago' : ' hours ago'); }
  const d = Math.floor(ms / DAY);
  if (d === 1) return 'yesterday';
  if (d < 31) return d + ' days ago';
  return fmtDate(ts);
}

// compact age for dense rows: "35m", "2h", "6d", "3mo"
function relShort(ts) {
  if (!ts) return '';
  const ms = ageMs(ts);
  if (ms < HOUR) return Math.max(1, Math.floor(ms / MIN)) + 'm';
  if (ms < DAY) return Math.floor(ms / HOUR) + 'h';
  const d = Math.floor(ms / DAY);
  return d < 60 ? d + 'd' : Math.floor(d / 30) + 'mo';
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = typeof ts === 'string' && ts.length === 10 ? new Date(ts + 'T00:00:00') : new Date(ts);
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
}
function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return fmtDate(ts) + ', ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function fmtMonth(ym) {     // "2026-09" → "September 2026"
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-PH', { month: 'long' }) + ' ' + y;
}

// date-only strings ("2026-09-17") for schedules
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function addDaysStr(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dueParts(dateStr) {   // {big, small} for the schedule row's date block
  const d = new Date(dateStr + 'T00:00:00');
  const diff = Math.round((d - new Date(todayStr() + 'T00:00:00')) / DAY);
  if (diff === 0) return { big: 'Today', small: MONTHS[d.getMonth()] + ' ' + d.getDate() };
  if (diff > 0 && diff < 7) return { big: DOWS[d.getDay()], small: MONTHS[d.getMonth()] + ' ' + d.getDate() };
  return { big: String(d.getDate()).padStart(2, '0'), small: MONTHS[d.getMonth()] };
}
function dueLabel(dateStr) {
  const diff = Math.round((new Date(dateStr + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / DAY);
  if (diff < 0) return 'overdue by ' + (-diff) + (diff === -1 ? ' day' : ' days');
  if (diff === 0) return 'due today';
  return 'due ' + fmtDate(dateStr);
}
function everyLabel(months) {
  if (months === 1) return 'every month';
  if (months === 12) return 'every year';
  if (months % 12 === 0) return 'every ' + (months / 12) + ' years';
  return 'every ' + months + ' months';
}

// Pesos are displayed in the Philippines; month boundaries for archive
// queries are fixed +08:00 like Menu does (no DST there, ever).
const PH = '+08:00';
function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const start = `${ym}-01T00:00:00${PH}`;
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${String(nm).padStart(2, '0')}-01T00:00:00${PH}`;
  return { start, end };
}

// ---- photos ----------------------------------------------------------------
// Shrink a phone photo to ≤1280px JPEG before it leaves the device. Years of
// full-size originals would be the dominant storage cost (spec §5).
function compressImage(file, maxPx = 1280, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      c.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not process the photo')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a photo this phone can read')); };
    img.src = url;
  });
}

// Open the camera / gallery and hand back the chosen File (or null).
function pickPhoto() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.onchange = () => resolve(input.files && input.files[0] ? input.files[0] : null);
    input.click();
  });
}

function uuid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
}

function nameKey(s) { return String(s || '').trim().toLowerCase(); }
