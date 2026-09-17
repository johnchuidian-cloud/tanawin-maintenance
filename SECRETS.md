# Where Maintenance's secrets live

**No secret values belong in this file — only where each one lives and how to get it
back.** The values live in `.env.local` (gitignored), which opens with a "do not delete
any line" header and a plain-English note above every key.

| Key | Used by | Canonical copy | If it's lost |
|---|---|---|---|
| `SUPABASE_URL` | everything; also public in `js/config.js` and `_headers` | Supabase → Project Settings → API | copy it again, harmless |
| `SUPABASE_PROJECT_REF` | `scripts/apply-sql.mjs`, Edge Function deploys | the id inside the URL | copy it again, harmless |
| `SUPABASE_ANON_KEY` | the app; public in `js/config.js` | same page → anon | copy it again, harmless |
| `SUPABASE_SERVICE_ROLE_KEY` | `scripts/seed-staff.mjs`, **the weekly backup script** | same page → service_role → Reveal | copy it again. ⚠️ While missing, backups skip this database **without failing** |
| `SUPABASE_ACCESS_TOKEN` | `scripts/apply-sql.mjs`, `supabase functions deploy` | **Lexi's** Supabase account (org Tanawin BnB) → Account → Access Tokens. John has no Supabase account | **cannot be read back** — generate a new one |
| `MAINTENANCE_DB_PASSWORD` | nothing in the app | chosen at project creation | reset in the Supabase dashboard; nothing else breaks |

The Edge Function needs no secrets set by hand: Supabase injects `SUPABASE_URL`,
`SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` into every function.

## Consumers to check when rebuilding `.env.local`

- `scripts/backup-db.mjs` **in the Finance repo** — reads `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` *from this repo's `.env.local`* once the project is
  added to it (done 2026-09-16). Easy to forget: the script lives elsewhere.
- `scripts/refresh-usb-folder.mjs` in the Finance repo copies this file into
  `Documents\Tanawin-USB-Backup\1-SECRETS\`.

## Backups of the file itself

- `~/Documents/tanawin-backups/secrets/` — with restore instructions
- `~/Documents/Tanawin-USB-Backup/1-SECRETS/` — rebuilt weekly

Refresh both after changing any key.
