// Run a SQL file (or a one-off statement) against the tanawin-maintenance
// Supabase project through the management API — no dashboard needed.
//
//   node scripts/apply-sql.mjs db/001_schema.sql
//   node scripts/apply-sql.mjs --sql "select count(*) from public.areas"
//
// Reads SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN from .env.local.
// Prints the JSON result (or the error) and exits non-zero on failure.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function env(key) {
  const text = readFileSync(join(root, '.env.local'), 'utf8');
  const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  const v = m ? m[1].trim() : '';
  if (!v) { console.error(`.env.local is missing ${key}`); process.exit(2); }
  return v;
}

const args = process.argv.slice(2);
let query;
if (args[0] === '--sql') query = args.slice(1).join(' ');
else if (args[0]) query = readFileSync(join(root, args[0]), 'utf8');
else { console.error('usage: node scripts/apply-sql.mjs <file.sql> | --sql "<statement>"'); process.exit(2); }

const ref = env('SUPABASE_PROJECT_REF');
const token = env('SUPABASE_ACCESS_TOKEN');

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
});
const text = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}\n${text}`);
  process.exit(1);
}
try { console.log(JSON.stringify(JSON.parse(text), null, 2)); } catch { console.log(text); }
