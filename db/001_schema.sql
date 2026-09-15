-- Tanawin Maintenance — 001: helpers, tables, RLS, storage, seed.
--
-- Run FIRST in the NEW tanawin-maintenance Supabase project (never in
-- Finance's, Menu's or Payroll's). Applied through the management API by
-- scripts/apply-sql.mjs; re-runnable pieces use "if not exists".
--
-- Principles (global ~/.claude/CLAUDE.md):
--   * RLS on for every table, default deny. anon has NO policy anywhere and
--     loses its default table grants below. The login picker reads names
--     through login_roster(), a security-definer function that returns
--     name/slug/role only.
--   * Every gate reads the staff TABLE (my_role(), is_active_staff()) —
--     never user_metadata, which a user can rewrite themselves.
--   * Names on history rows are text snapshots (*_name) with a nullable
--     *_id beside them. No FK to staff from history, so a departure never
--     changes a record.
--   * Nothing is deleted: staff deactivate, areas/equipment/schedules
--     archive, issues live forever in the archive view.

-- ---------------------------------------------------------------------------
-- staff (the people). PINs live only in GoTrue. Written only by the
-- manage-staff Edge Function (service role) and the seed script.
-- ---------------------------------------------------------------------------
create table if not exists public.staff (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  role           text not null default 'staff' check (role in ('owner', 'admin', 'staff')),
  is_active      boolean not null default true,
  auth_uid       uuid not null unique,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  deactivated_at timestamptz
);
comment on table public.staff is
  'One row per person. Exactly one owner (partial unique index). Read by every active staff member; written only by the manage-staff Edge Function.';

-- Structural owner protection: there can only ever be one owner row.
create unique index if not exists staff_one_owner on public.staff (role) where role = 'owner';

-- ---------------------------------------------------------------------------
-- Gate helpers. security definer so they can read staff regardless of the
-- caller's own policies; stable so the planner calls them once per query.
-- ---------------------------------------------------------------------------
create or replace function public.my_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.staff where auth_uid = auth.uid() and is_active limit 1
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.staff where auth_uid = auth.uid() and is_active limit 1
$$;

create or replace function public.my_name() returns text
language sql stable security definer set search_path = public as $$
  select name from public.staff where auth_uid = auth.uid() and is_active limit 1
$$;

create or replace function public.is_active_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where auth_uid = auth.uid() and is_active)
$$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff
                 where auth_uid = auth.uid() and is_active and role in ('owner', 'admin'))
$$;

-- Login picker, pre-auth. Names, slugs and roles only — no ids, no PINs.
-- This is the ONLY function anon may execute.
create or replace function public.login_roster()
returns table (slug text, name text, role text)
language sql stable security definer set search_path = public as $$
  select slug, name, role from public.staff where is_active order by sort_order, name
$$;

-- ---------------------------------------------------------------------------
-- settings — one row.
-- ---------------------------------------------------------------------------
create table if not exists public.settings (
  id                     int primary key default 1 check (id = 1),
  hide_prices_from_staff boolean not null default false,
  stale_after_days       int not null default 4 check (stale_after_days between 1 and 60),
  updated_at             timestamptz not null default now()
);
comment on table public.settings is
  'Single row. hide_prices_from_staff is a UI toggle (staff enter prices themselves, so it cannot be a data gate). stale_after_days = the "overdue" threshold.';
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- areas — managed data, grouped. blocks_booking lives on the GROUP.
-- ---------------------------------------------------------------------------
create table if not exists public.area_groups (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  blocks_booking boolean not null default false,
  sort           int not null default 0,
  created_at     timestamptz not null default now()
);

create table if not exists public.areas (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.area_groups (id),
  name        text not null,
  sort        int not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists areas_name_key on public.areas (lower(btrim(name)));
comment on table public.areas is 'Archive, never delete: old issues must always resolve to a real place.';

-- ---------------------------------------------------------------------------
-- equipment — tools, machines and consumable stock, one list.
-- ---------------------------------------------------------------------------
create table if not exists public.equipment (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  category                text not null check (category in ('Power tools', 'Grounds', 'Pool', 'Hand tools', 'Consumables')),
  area_id                 uuid not null references public.areas (id),
  condition               text not null default 'working' check (condition in ('working', 'service due', 'broken')),
  qty                     numeric not null default 1 check (qty >= 0),
  unit                    text,
  low_stock_threshold     numeric check (low_stock_threshold >= 0),
  service_interval_months int check (service_interval_months > 0),
  last_serviced_at        date,
  purchase_date           date,
  warranty_expires        date,
  purchase_price          numeric check (purchase_price >= 0),
  photo_path              text,
  note                    text,
  created_by_name         text,
  archived_at             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
comment on table public.equipment is
  'Assets (tracked by condition) and consumables (tracked by qty vs low_stock_threshold) in one list. A service_interval_months generates the matching schedules row (trigger in 002).';

-- ---------------------------------------------------------------------------
-- issues — the work orders. Status is DERIVED from the timestamps.
-- ---------------------------------------------------------------------------
create table if not exists public.issues (
  id                   uuid primary key default gen_random_uuid(),
  area_id              uuid not null references public.areas (id),
  equipment_id         uuid references public.equipment (id),
  title                text not null check (length(btrim(title)) between 1 and 200),
  description          text check (length(description) <= 4000),
  category             text not null default 'Other',
  priority             text not null default 'routine' check (priority in ('routine', 'soon', 'urgent')),
  reported_by_name     text not null,
  reported_by_id       uuid,
  reported_at          timestamptz not null default now(),
  acknowledged_by_name text,
  acknowledged_by_id   uuid,
  acknowledged_at      timestamptz,
  assigned_to_name     text,
  assigned_to_id       uuid,                 -- null for an outside contractor
  started_at           timestamptz,
  started_by_name      text,
  completed_at         timestamptz,
  completed_by_name    text,
  resolution_note      text check (length(resolution_note) <= 4000),
  vendor_contact       text check (length(vendor_contact) <= 500),
  reopened_count       int not null default 0,
  last_reopened_at     timestamptz,
  photo_count          int not null default 0,
  updated_at           timestamptz not null default now()
);
create index if not exists issues_open_idx     on public.issues (reported_at desc) where completed_at is null;
create index if not exists issues_archive_idx  on public.issues (completed_at desc, id) where completed_at is not null;
create index if not exists issues_area_idx     on public.issues (area_id);
create index if not exists issues_equipment_idx on public.issues (equipment_id) where equipment_id is not null;
comment on table public.issues is
  'Work orders. reported/acknowledged/started/completed timestamps ARE the status. Reopen clears started/completed and bumps reopened_count — one record, history intact in issue_events.';

create table if not exists public.issue_photos (
  id               uuid primary key default gen_random_uuid(),
  issue_id         uuid not null references public.issues (id),
  path             text not null,            -- storage object path in bucket "photos"
  kind             text not null default 'before' check (kind in ('before', 'after')),
  uploaded_by_name text not null,
  uploaded_by_id   uuid,
  bytes            int,
  uploaded_at      timestamptz not null default now()
);
create index if not exists issue_photos_issue_idx on public.issue_photos (issue_id, uploaded_at);

create table if not exists public.issue_notes (
  id          uuid primary key default gen_random_uuid(),
  issue_id    uuid not null references public.issues (id),
  author_name text not null,
  author_id   uuid,
  body        text not null check (length(btrim(body)) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists issue_notes_issue_idx on public.issue_notes (issue_id, created_at);

create table if not exists public.issue_events (
  id         uuid primary key default gen_random_uuid(),
  issue_id   uuid not null references public.issues (id),
  actor_name text not null,
  actor_id   uuid,
  kind       text not null,                  -- reported | acknowledged | assigned | started | fixed | reopened | priority | edited
  from_value text,
  to_value   text,
  at         timestamptz not null default now()
);
create index if not exists issue_events_issue_idx on public.issue_events (issue_id, at);
comment on table public.issue_events is 'Append-only status history, written by triggers only.';

-- ---------------------------------------------------------------------------
-- schedules — preventive maintenance. A second data model, not a flag.
-- ---------------------------------------------------------------------------
create table if not exists public.schedules (
  id                uuid primary key default gen_random_uuid(),
  area_id           uuid not null references public.areas (id),
  equipment_id      uuid unique references public.equipment (id),   -- set = generated from that item's service interval
  task              text not null check (length(btrim(task)) between 1 and 200),
  interval_months   int not null check (interval_months between 1 and 120),
  next_due_at       date not null,
  last_completed_at date,
  due_alerted_for   date,                    -- the next_due_at an alert was already raised for
  note              text,
  created_by_name   text,
  archived_at       timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists schedules_due_idx on public.schedules (next_due_at) where archived_at is null;

create table if not exists public.schedule_completions (
  id                uuid primary key default gen_random_uuid(),
  schedule_id       uuid not null references public.schedules (id),
  completed_by_name text not null,
  completed_by_id   uuid,
  completed_at      timestamptz not null default now(),
  note              text
);
create index if not exists schedule_completions_idx on public.schedule_completions (schedule_id, completed_at desc);

-- ---------------------------------------------------------------------------
-- items — purchase checklist lines, per issue OR per schedule.
-- ---------------------------------------------------------------------------
create table if not exists public.items (
  id                   uuid primary key default gen_random_uuid(),
  issue_id             uuid references public.issues (id),
  schedule_id          uuid references public.schedules (id),
  name                 text not null check (length(btrim(name)) between 1 and 120),
  qty                  numeric not null default 1 check (qty > 0),
  unit                 text,
  estimated_unit_price numeric check (estimated_unit_price >= 0),
  actual_unit_price    numeric check (actual_unit_price >= 0),
  vendor               text,
  note                 text check (length(note) <= 500),
  acquired             boolean not null default false,
  acquired_at          timestamptz,
  acquired_by_name     text,
  created_by_name      text,
  created_by_id        uuid,
  created_at           timestamptz not null default now(),
  check ((issue_id is not null)::int + (schedule_id is not null)::int = 1)
);
create index if not exists items_issue_idx    on public.items (issue_id) where issue_id is not null;
create index if not exists items_schedule_idx on public.items (schedule_id) where schedule_id is not null;
comment on table public.items is
  'Estimate and actual are separate columns. Only actual is ever treated as real, and nothing in the app sums either as spend — Finance owns spend.';

create table if not exists public.item_catalog (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  name_key          text not null unique,    -- lower(btrim(name))
  last_actual_price numeric,
  last_vendor       text,
  times_bought      int not null default 0,
  updated_at        timestamptz not null default now()
);
comment on table public.item_catalog is 'Remembered prices. Written only by acquire_items()/restock_equipment(). What makes the shopping list useful in year three.';

-- ---------------------------------------------------------------------------
-- alerts — in-app only. Written by triggers, read state per person.
-- ---------------------------------------------------------------------------
create table if not exists public.alerts (
  id          uuid primary key default gen_random_uuid(),
  audience    text not null check (audience in ('staff', 'owner', 'all')),
  target_id   uuid,                          -- set = only this person sees it (overrides audience)
  kind        text not null check (kind in ('new', 'good', 'warn')),
  actor_name  text,
  actor_id    uuid,
  text        text not null,
  subtext     text,
  issue_id    uuid references public.issues (id),
  schedule_id uuid references public.schedules (id),
  read_by     uuid[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists alerts_recent_idx on public.alerts (created_at desc);
comment on table public.alerts is 'In-app only, by decision. No push, email or Telegram. The actor never sees their own action.';

-- ---------------------------------------------------------------------------
-- RLS — on everywhere, anon nowhere.
-- ---------------------------------------------------------------------------
alter table public.staff                enable row level security;
alter table public.settings             enable row level security;
alter table public.area_groups          enable row level security;
alter table public.areas                enable row level security;
alter table public.equipment            enable row level security;
alter table public.issues               enable row level security;
alter table public.issue_photos         enable row level security;
alter table public.issue_notes          enable row level security;
alter table public.issue_events         enable row level security;
alter table public.schedules            enable row level security;
alter table public.schedule_completions enable row level security;
alter table public.items                enable row level security;
alter table public.item_catalog         enable row level security;
alter table public.alerts               enable row level security;

-- Supabase grants anon/authenticated on every public table by default.
-- Take anon's away entirely (and for tables created later) so the anon key
-- is inert beyond login_roster().
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- staff: everyone active can see the list (assignment, settings). No writes.
drop policy if exists "active staff read staff" on public.staff;
create policy "active staff read staff" on public.staff
  for select to authenticated using (public.is_active_staff());

-- settings: read all, update owner only.
drop policy if exists "active staff read settings" on public.settings;
create policy "active staff read settings" on public.settings
  for select to authenticated using (public.is_active_staff());
drop policy if exists "owner updates settings" on public.settings;
create policy "owner updates settings" on public.settings
  for update to authenticated using (public.my_role() = 'owner') with check (public.my_role() = 'owner');

-- area_groups / areas: read all, write owner + admin, no delete.
drop policy if exists "active staff read area_groups" on public.area_groups;
create policy "active staff read area_groups" on public.area_groups
  for select to authenticated using (public.is_active_staff());
drop policy if exists "managers write area_groups" on public.area_groups;
create policy "managers write area_groups" on public.area_groups
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

drop policy if exists "active staff read areas" on public.areas;
create policy "active staff read areas" on public.areas
  for select to authenticated using (public.is_active_staff());
drop policy if exists "managers insert areas" on public.areas;
create policy "managers insert areas" on public.areas
  for insert to authenticated with check (public.is_manager());
drop policy if exists "managers update areas" on public.areas;
create policy "managers update areas" on public.areas
  for update to authenticated using (public.is_manager()) with check (public.is_manager());

-- equipment: read all; add/edit/archive owner + admin. Staff change condition,
-- quantity, note and photo through set_equipment_state() (002).
drop policy if exists "active staff read equipment" on public.equipment;
create policy "active staff read equipment" on public.equipment
  for select to authenticated using (public.is_active_staff());
drop policy if exists "managers insert equipment" on public.equipment;
create policy "managers insert equipment" on public.equipment
  for insert to authenticated with check (public.is_manager());
drop policy if exists "managers update equipment" on public.equipment;
create policy "managers update equipment" on public.equipment
  for update to authenticated using (public.is_manager()) with check (public.is_manager());

-- issues: every active staff member reads, reports and updates. No delete.
drop policy if exists "active staff read issues" on public.issues;
create policy "active staff read issues" on public.issues
  for select to authenticated using (public.is_active_staff());
drop policy if exists "active staff report issues" on public.issues;
create policy "active staff report issues" on public.issues
  for insert to authenticated with check (public.is_active_staff() and reported_by_id = public.my_id());
drop policy if exists "active staff update issues" on public.issues;
create policy "active staff update issues" on public.issues
  for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

drop policy if exists "active staff read issue_photos" on public.issue_photos;
create policy "active staff read issue_photos" on public.issue_photos
  for select to authenticated using (public.is_active_staff());
drop policy if exists "active staff add issue_photos" on public.issue_photos;
create policy "active staff add issue_photos" on public.issue_photos
  for insert to authenticated with check (public.is_active_staff() and uploaded_by_id = public.my_id());

drop policy if exists "active staff read issue_notes" on public.issue_notes;
create policy "active staff read issue_notes" on public.issue_notes
  for select to authenticated using (public.is_active_staff());
drop policy if exists "active staff add issue_notes" on public.issue_notes;
create policy "active staff add issue_notes" on public.issue_notes
  for insert to authenticated with check (public.is_active_staff() and author_id = public.my_id());

drop policy if exists "active staff read issue_events" on public.issue_events;
create policy "active staff read issue_events" on public.issue_events
  for select to authenticated using (public.is_active_staff());

-- schedules: read all; add/edit/archive owner + admin; completion via RPC.
drop policy if exists "active staff read schedules" on public.schedules;
create policy "active staff read schedules" on public.schedules
  for select to authenticated using (public.is_active_staff());
drop policy if exists "managers insert schedules" on public.schedules;
create policy "managers insert schedules" on public.schedules
  for insert to authenticated with check (public.is_manager());
drop policy if exists "managers update schedules" on public.schedules;
create policy "managers update schedules" on public.schedules
  for update to authenticated using (public.is_manager()) with check (public.is_manager());

drop policy if exists "active staff read schedule_completions" on public.schedule_completions;
create policy "active staff read schedule_completions" on public.schedule_completions
  for select to authenticated using (public.is_active_staff());

-- items: checklist lines are working notes, not history — staff manage them.
drop policy if exists "active staff read items" on public.items;
create policy "active staff read items" on public.items
  for select to authenticated using (public.is_active_staff());
drop policy if exists "active staff add items" on public.items;
create policy "active staff add items" on public.items
  for insert to authenticated with check (public.is_active_staff() and created_by_id = public.my_id());
drop policy if exists "active staff update items" on public.items;
create policy "active staff update items" on public.items
  for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());
drop policy if exists "active staff delete items" on public.items;
create policy "active staff delete items" on public.items
  for delete to authenticated using (public.is_active_staff() and not acquired);

drop policy if exists "active staff read item_catalog" on public.item_catalog;
create policy "active staff read item_catalog" on public.item_catalog
  for select to authenticated using (public.is_active_staff());

-- alerts: audience rules. A targeted alert is seen by its target only; otherwise
-- owner sees owner+all, staff sees staff+all, admins see everything. Nobody
-- sees their own action. Read state is written by mark_alerts_read() only.
drop policy if exists "audience reads alerts" on public.alerts;
create policy "audience reads alerts" on public.alerts
  for select to authenticated using (
    public.is_active_staff()
    and (actor_id is null or actor_id <> public.my_id())
    and (
      (target_id is not null and target_id = public.my_id())
      or (target_id is null and (
            audience = 'all'
            or public.my_role() = 'admin'
            or (audience = 'owner' and public.my_role() = 'owner')
            or (audience = 'staff' and public.my_role() = 'staff')))
    )
  );

-- ---------------------------------------------------------------------------
-- Function grants. Helpers are used inside policies, so authenticated must be
-- able to execute them; anon gets login_roster() and nothing else.
-- ---------------------------------------------------------------------------
revoke execute on function public.my_id(), public.my_role(), public.my_name(),
  public.is_active_staff(), public.is_manager() from public, anon;
grant execute on function public.my_id(), public.my_role(), public.my_name(),
  public.is_active_staff(), public.is_manager() to authenticated;
revoke execute on function public.login_roster() from public;
grant execute on function public.login_roster() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage: one PRIVATE bucket. Size and MIME enforced here, not in the picker.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 3145728, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do update
  set public = false, file_size_limit = 3145728,
      allowed_mime_types = array['image/jpeg', 'image/webp', 'image/png'];

drop policy if exists "active staff read photos" on storage.objects;
create policy "active staff read photos" on storage.objects
  for select to authenticated using (bucket_id = 'photos' and public.is_active_staff());
drop policy if exists "active staff upload photos" on storage.objects;
create policy "active staff upload photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'photos' and public.is_active_staff());
drop policy if exists "managers delete photos" on storage.objects;
create policy "managers delete photos" on storage.objects
  for delete to authenticated using (bucket_id = 'photos' and public.is_manager());

-- ---------------------------------------------------------------------------
-- Seed: 5 groups, 29 areas (spec §4, confirmed 2026-09-06).
-- ---------------------------------------------------------------------------
insert into public.area_groups (name, blocks_booking, sort) values
  ('Guest rooms', true, 1),
  ('Common areas', false, 2),
  ('Work areas', false, 3),
  ('Outdoors & grounds', false, 4),
  ('Utilities', false, 5)
on conflict (name) do nothing;

with g as (select id, name from public.area_groups),
     seed(group_name, area_name, sort) as (values
  ('Guest rooms', 'Ambon Ambon', 1), ('Guest rooms', 'Bisay', 2), ('Guest rooms', 'Kairukan', 3),
  ('Guest rooms', 'Dunsulan', 4), ('Guest rooms', 'Limutan', 5), ('Guest rooms', 'Pasukulan', 6),
  ('Guest rooms', 'Silanganan', 7), ('Guest rooms', 'Tikip', 8),
  ('Guest rooms', 'Mt Pinatubo', 9), ('Guest rooms', 'Mt Natib', 10), ('Guest rooms', 'Mt Sta Rosa', 11),
  ('Guest rooms', 'Glamping Tent 1', 12), ('Guest rooms', 'Glamping Tent 2', 13),
  ('Guest rooms', 'Glamping Tent 3', 14), ('Guest rooms', 'Glamping Tent 4', 15),
  ('Common areas', '3rd Floor Dining', 1), ('Common areas', 'Garden', 2), ('Common areas', 'Steel Deck', 3),
  ('Work areas', '3rd Floor Wing Kitchen', 1), ('Work areas', 'Ground Floor Staff Kitchen', 2),
  ('Work areas', 'Laundry Area', 3), ('Work areas', 'Staff Area', 4), ('Work areas', 'Front Desk Area', 5),
  ('Work areas', 'Barbecue Hut Stock Room', 6), ('Work areas', 'Front Desk Stock Room', 7),
  ('Work areas', 'Annex Stock Room', 8),
  ('Outdoors & grounds', 'Pool Area', 1), ('Outdoors & grounds', 'Path & Stairs', 2),
  ('Outdoors & grounds', 'Parking', 3), ('Outdoors & grounds', 'Garbage Area', 4),
  ('Utilities', 'Generator', 1), ('Utilities', 'Septic Tank 1', 2), ('Utilities', 'Septic Tank 2', 3),
  ('Utilities', 'Septic Tank 3', 4), ('Utilities', 'Pool Equipment & Pump', 5))
insert into public.areas (group_id, name, sort)
select g.id, seed.area_name, seed.sort
from seed join g on g.name = seed.group_name
on conflict do nothing;
