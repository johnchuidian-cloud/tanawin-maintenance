// Copies the PUBLIC values from .env.local into the two files that must
// carry them: js/config.js (URL + anon key) and _headers (the project host in
// the CSP). Run once after creating the Supabase project, and again if the
// anon key is ever rotated. Idempotent.
//
//   node scripts/fill-config.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envText = readFileSync(join(root, '.env.local'), 'utf8');
const env = (key) => {
  const m = envText.match(new RegExp(`^${key}=(.*)$`, 'm'));
  const v = m ? m[1].trim() : '';
  if (!v) { console.error(`.env.local is missing ${key}`); process.exit(2); }
  return v;
};

const url = env('SUPABASE_URL').replace(/\/+$/, '');
const anon = env('SUPABASE_ANON_KEY');
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)) {
  console.error(`SUPABASE_URL does not look like a Supabase project URL: ${url}`);
  process.exit(2);
}
if (/^eyJ/.test(anon) === false && /^sb_publishable_/.test(anon) === false) {
  console.error('SUPABASE_ANON_KEY does not look like an anon/publishable key');
  process.exit(2);
}
const host = url.replace('https://', '');

function patch(file, edits) {
  const p = join(root, file);
  let text = readFileSync(p, 'utf8');
  for (const [re, val] of edits) text = text.replace(re, val);
  writeFileSync(p, text);
  console.log(`updated ${file}`);
}

patch('js/config.js', [
  [/const SUPABASE_URL = '[^']*';/, `const SUPABASE_URL = '${url}';`],
  [/const SUPABASE_ANON_KEY = '[^']*';/, `const SUPABASE_ANON_KEY = '${anon}';`],
]);
patch('_headers', [
  [/__SUPABASE_HOST__/g, host],
  [/https:\/\/[a-z0-9]+\.supabase\.co/g, `https://${host}`],
]);
