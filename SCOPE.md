# Tanawin Maintenance — build scope (locked 2026-09-15)

This is the scoping pass the spec asked for before any code. It records every decision
the spec left open, what was copied from which sibling app, and what is blocked on
whom. The spec (`~/Downloads/tanawin-maintenance-spec.md`) and the clickable prototype
(https://claude.ai/artifact/QYNfc83DkZjciHAUrY9Vmq) stay the references for *what* the
screens do; this file is the reference for *how* it is built.

## 1. Stack

| Choice | Decision | Why |
|---|---|---|
| Front end | Vanilla HTML/CSS/JS, **no build step**, supabase-js from jsdelivr | Same as Menu and Concierge. Matches the prototype's structure one-to-one, deploys as an assets-only Worker, zips cleanly into the USB backup, and nothing can wedge a dev runtime. |
| Pages | `index.html` (login gate + the whole app), `print.html` (archive month, printable) | The app is a single screen with a bottom nav and bottom sheets. The print view is a separate page so the browser's print dialog gets a clean document. |
| Database | **New standalone Supabase project** `tanawin-maintenance`, org "Tanawin BnB", region ap-southeast-1 | Spec §2. RLS on from the first migration; default deny. |
| Auth | Supabase Auth. Login = pick your name, type a 4-digit PIN. Hidden email `<slug>@tanawin.maintenance`, password `tanawin-maintenance-v1:<pin>` | Menu's approach, as the spec prefers. GoTrue does hashing, sessions, rate limiting. The prefix is public; the secret is the 4 digits, same trade-off as Menu/Concierge. |
| Staff writes | `manage-staff` Edge Function (service role), gated on the **`staff` table**, never `user_metadata` | Spec §3 "owner protection must be structural". This is the one place Menu's pattern was deliberately not copied. |
| Hosting | Cloudflare Worker, static assets, `wrangler.jsonc` serving the repo root | Same as Menu/Concierge. Proposed name `tanawin-maintenance` → `tanawin-maintenance.tanawinbnb.workers.dev` (spec §10 open item; John confirms). |
| Sessions | `localStorage` (supabase-js default) — signed in until explicit log out | Same as Menu, Concierge, Payroll. Staff on phones should not be logged out by closing a tab. |
| Update banner | Concierge's `update-check.js` (document + same-origin assets hash) | No build step, so no `/version.json`; document-only hashing is inert for JS-only deploys. |
| Local dev | `npx http-server -p 3700 -c-1 .` | Next free port in the suite (Concierge is 3600). |

## 2. Roles, gates and the owner

- `staff.role` ∈ `owner | admin | staff`. **Exactly one owner**, enforced by a unique
  partial index — not by convention.
- Every RLS policy and every RPC gates on SQL helpers that read the `staff` row for
  `auth.uid()`: `my_role()`, `is_active_staff()`. A deactivated person's token still
  exists but every table returns zero rows and every RPC refuses.
- Deactivation also bans the GoTrue user, so the login itself stops working, not just
  the data. **Delete exists too** (added 2026-09-16 at John's request: the seeded list
  included kitchen-only people). Owner may delete anyone but herself; admins may delete
  staff. Safe because history rows carry names as text, never a link to `staff`.
- Role changes: owner only, and never the owner's own role. Admin adding a person can
  only create `staff`. Admin can reset a staff PIN, not an admin's or the owner's.
  Everyone can change their own PIN.
- Names on issues, notes, photos, items, completions and alerts are **text snapshots**
  (`*_name`), with a nullable `*_id` beside them for "mine" logic. No foreign keys to
  `staff` from history tables, so a departure changes nothing in the record.

## 3. Data model (as built — column names are final here, not in the spec)

`settings` (one row) · `area_groups` · `areas` · `staff` · `issues` · `issue_photos` ·
`issue_notes` · `issue_events` · `items` · `item_catalog` · `equipment` · `schedules` ·
`schedule_completions` · `alerts`. See `db/001_schema.sql` — every table has a comment
saying who can do what.

Decisions the spec left open:

- **Status is derived, never stored.** `acknowledged_at`, `started_at`, `completed_at`
  are the truth; the client derives reported / in progress / fixed and "unseen".
- **Reopen** clears `started_at` and `completed_at`, bumps `reopened_count`, and the
  event log keeps every previous fix. History intact, one record.
- **Stalled** = acknowledged, not started, older than `settings.stale_after_days`
  (default 4). This is the "overdue" threshold in spec §5 Aging. Owner-editable later
  if wanted; it is data, not code.
- **`blocks_booking` lives on `area_groups`**, seeded true for Guest rooms only.
- **Categories** (trade) are a client-side list, stored as text on the issue.
  Electrical, Plumbing, Aircon, Hardware, Furniture, Painting, Grounds, Appliance, Other.
- **Items** belong to an issue *or* a schedule (check constraint). Low-stock consumables
  are computed live from `equipment` for the shopping list, not stored as items; buying
  one restocks the equipment quantity.
- **`item_catalog`** is keyed on `lower(trim(name))` and is updated inside the
  `acquire_items` RPC whenever an actual price is saved — the one write that makes the
  list useful in year three.
- **No prices at all (John, 2026-09-16).** The spec allowed optional item prices and a
  remembered-price catalog; John removed them entirely: "different stores have different
  costs, all money is in Finance." The price columns still exist in the tables but the app
  never reads or writes them, the staff price toggle is gone, and the catalog is name
  suggestions only. A price worth remembering goes in the item's note.
- **Equipment with a `service_interval_months` owns exactly one schedule row**
  (`schedules.equipment_id` unique), maintained by a trigger. Completing it stamps
  `equipment.last_serviced_at` and clears a `service due` condition.
- **Equipment ↔ work order:** `issues.equipment_id` (nullable). Reporting from an
  equipment card pre-links and sets the condition to `broken`; marking that issue fixed
  sets it back to `working`. Both directions are one fact.
- **Alerts** are inserted by triggers, never by the client. `audience` ∈
  `staff | owner | all`, optional `target_id` for "assigned to you". Read state is
  per person (`read_by uuid[]`), written only through `mark_alerts_read`. The actor
  never sees their own action. Owner sees `owner` + `all`; admins see everything;
  staff see `staff` + `all`.
- **Schedule-due alerts** come from `sync_due_alerts()`, called on every app load;
  idempotent via `schedules.due_alerted_for`. No pg_cron, nothing to forget.
- **Photos** go to a **private** Storage bucket `photos` (3 MB cap, jpeg/webp/png only,
  enforced in the bucket). The client compresses to ≤1280px JPEG before upload.
  Photos are fetched by signed URL only when a sheet opens; list reads never carry
  image bytes. Uploads fail visibly with a Retry that keeps the file in memory.

## 4. Client behaviour that differs by role (spec §6b)

- **owner → overview** (score row, grouped cards, "Assign to someone" in the
  acknowledge slot).
- **admin and staff → triage** (one unclaimed issue at a time). Queue = open issues
  that are unassigned, *or* assigned to me but not yet acknowledged, so an issue Lexi
  assigns still lands in that person's triage. "I'll take this" = assign + acknowledge.
- Assignment by owner/admin does **not** acknowledge — Lexi keeps seeing "unseen"
  until the assignee opens it, which is the whole point of the flag.
- Both roles get the same collapsed by-area list underneath and the same bottom nav.
- Gear in the top bar: owner + admin. Tapping your own name chip: change PIN, log out.

## 5. Scale rules applied (spec §8)

- Open issues are the only unbounded-ish read on load, and they are bounded by reality.
  Archive reads are by month, paged in 200s on `(completed_at, id)`.
- Month totals come from `issues_months()` in SQL — never from `data.length`.
- Catalog suggestions are capped at the 500 most recently updated names.
- Alerts load the newest 100 for my audience; older ones stay in the table.
- Nothing is deleted: staff deactivate, areas/equipment/schedules archive, issues live
  forever in the archive view.

## 6. Security checklist (global CLAUDE.md, applied)

- RLS on every table; anon has **no** policy anywhere. Login picker reads the roster
  through `login_roster()` (security definer, returns name/slug/role only, no ids).
- Every RPC: role gate in the body **and** `revoke execute from anon, public`.
- No `select *` in the client. Credential material never exists in our tables at all.
- `_headers` from day one: CSP enforcing from the first deploy (new app, no live users to
  break; built from exactly what the page loads: self, jsdelivr, the project URL).
- Only the anon key ships in `js/config.js`. Service role key, access token and DB
  password live in `.env.local` (gitignored, self-documenting header).
- (Removed 2026-09-16) The price-visibility toggle is gone along with all prices.

## 7. Build order followed

1. Auth + staff + roles + settings gear ← `db/001`, `manage-staff`, `js/auth.js`, settings sheets
2. Areas, seeded ← `db/001` seed. ⚠️ The spec's heading says "29 areas" but its own
   list holds **35** (15 + 3 + 8 + 4 + 5); every listed area is seeded, so 35 is the
   true count and the prototype's "29" was a miscount, not a cut.
3. Issues: report, list, sheet, transitions, photos, notes
4. Role default views + shared by-area list
5. Items + catalog + consolidated shopping list
6. Equipment
7. Schedules, generated from equipment intervals
8. Alerts
9. Archive + print
10. Hub tile — **separate work order**, written to `~/Downloads/tanawin-hub-work-order-maintenance.md` once the URL is live

## 8. Blocked on people (none of this can be faked locally — there is no Docker here)

| Step | Who | Notes |
|---|---|---|
| Create the Supabase project + paste 4 values into `.env.local` | **John** (he has dashboard access via GitHub, org "Tanawin BnB") | `WHAT-JOHN-DOES-NEXT.md` has the clicks. Until then: migrations unapplied, nothing verified end-to-end. |
| Starting PINs | Lexi | `scripts/seed-staff.mjs` generates random ones and writes them to `staff-login.txt` (gitignored) for Lexi to hand out. Everyone changes theirs on first login. |
| Connect Cloudflare to `tanawinbnb/tanawin-maintenance` | John or Lexi | After the first push. Worker name `tanawin-maintenance`. |
| Public mirror repo | John | `johnchuidian-cloud/tanawin-maintenance` — his account, web form. |
| Backups | this session, after keys exist | Add the project to Finance's `scripts/backup-db.mjs` and the USB folder list. |

## 9. Deliberately not built

- Cost reporting of any kind (spec §7). CSV export. Push/Telegram/email alerts.
- A Hub badge. A Concierge → Maintenance conversion (v1 is manual).
- Editing area *groups* in the UI — five groups are seeded; a new group is a one-line SQL insert.
