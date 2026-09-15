// One-time seed of the first people, run AFTER db/001 and db/002.
//
//   node scripts/seed-staff.mjs
//
// Creates a GoTrue login and a `staff` row for each person below, with a
// random starting 4-digit PIN, and writes the PINs to staff-login.txt
// (gitignored) for Lexi to hand out. Everyone changes their PIN after first
// login (tap your name in the top bar). Safe to re-run: people who already
// have a staff row are skipped, and their PIN is NOT touched.
//
// Uses the service role key from .env.local — it never leaves this machine.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = (key) => {
  const m = readFileSync(join(root, '.env.local'), 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
  const v = m ? m[1].trim() : '';
  if (!v) { console.error(`.env.local is missing ${key}`); process.exit(2); }
  return v;
};
const URL = env('SUPABASE_URL');
const SERVICE = env('SUPABASE_SERVICE_ROLE_KEY');

// Same people as Menu/Kitchen (prototype roster). Lexi = owner, Rio = admin
// from day one (spec §3).
const ROSTER = [
  { name: 'Lexi',    role: 'owner' },
  { name: 'Rio',     role: 'admin' },
  { name: 'Janice',  role: 'staff' },
  { name: 'Monique', role: 'staff' },
  { name: 'Disang',  role: 'staff' },
  { name: 'Sherill', role: 'staff' },
];

const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const slugify = (n) => n.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const pin4 = () => String(randomInt(0, 10000)).padStart(4, '0');

async function rest(path, init) {
  const res = await fetch(`${URL}${path}`, { ...init, headers: { ...H, ...(init?.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const existing = await rest('/rest/v1/staff?select=slug,name,role,is_active&order=sort_order');
const taken = new Set(existing.map((r) => r.slug));
const lines = [];
let sort = existing.length;

for (const p of ROSTER) {
  const slug = slugify(p.name);
  if (taken.has(slug)) { console.log(`skip ${p.name} (already exists)`); continue; }
  const pin = pin4();
  const user = await rest('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email: `${slug}@tanawin.maintenance`,
      password: `tanawin-maintenance-v1:${pin}`,
      email_confirm: true,
      user_metadata: { name: p.name },
    }),
  });
  await rest('/rest/v1/staff', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ slug, name: p.name, role: p.role, auth_uid: user.id, sort_order: ++sort }),
  });
  lines.push(`${p.name.padEnd(10)} ${p.role.padEnd(6)} PIN ${pin}`);
  console.log(`added ${p.name} (${p.role})`);
}

if (lines.length) {
  const file = join(root, 'staff-login.txt');
  const prev = existsSync(file) ? readFileSync(file, 'utf8') + '\n' : '';
  writeFileSync(file, prev +
    `Tanawin Maintenance — starting PINs (generated ${new Date().toISOString().slice(0, 10)})\n` +
    `Pick your name, enter the PIN. Change it after first login: tap your name in the top bar.\n\n` +
    lines.join('\n') + '\n');
  console.log(`PINs written to staff-login.txt (gitignored) — hand them to Lexi, never paste them in chat.`);
} else {
  console.log('nothing to do');
}
