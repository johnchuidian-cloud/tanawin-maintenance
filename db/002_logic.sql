-- Tanawin Maintenance — 002: triggers and RPCs. Run AFTER 001.
--
-- Every function here is security definer with the role gate IN THE BODY,
-- and every RPC ends with an explicit revoke from anon/public. If a later
-- migration CREATE OR REPLACEs any of them, it must repeat the revoke —
-- Supabase re-applies the default grants on every replace.

-- ---------------------------------------------------------------------------
-- Small internal helpers (not callable by clients).
-- ---------------------------------------------------------------------------
create or replace function public._actor_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select name from public.staff where auth_uid = auth.uid() limit 1), 'System')
$$;

create or replace function public._area_name(p_area uuid) returns text
language sql stable security definer set search_path = public as $$
  select name from public.areas where id = p_area
$$;

create or replace function public._alert(
  p_audience text, p_kind text, p_text text, p_subtext text,
  p_issue uuid default null, p_schedule uuid default null, p_target uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.alerts (audience, target_id, kind, actor_name, actor_id, text, subtext, issue_id, schedule_id)
  values (p_audience, p_target, p_kind, public._actor_name(), public.my_id(), p_text, p_subtext, p_issue, p_schedule);
end $$;

create or replace function public._event(p_issue uuid, p_kind text, p_from text, p_to text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.issue_events (issue_id, actor_name, actor_id, kind, from_value, to_value)
  values (p_issue, public._actor_name(), public.my_id(), p_kind, p_from, p_to);
end $$;

revoke execute on function public._actor_name(), public._area_name(uuid),
  public._alert(text, text, text, text, uuid, uuid, uuid), public._event(uuid, text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- issues: immutable origin fields, updated_at, events + alerts on transitions.
-- ---------------------------------------------------------------------------
create or replace function public.issues_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- The origin of a report never changes, whoever edits it later.
  new.reported_by_name := old.reported_by_name;
  new.reported_by_id   := old.reported_by_id;
  new.reported_at      := old.reported_at;
  new.photo_count      := old.photo_count;      -- maintained by the photos trigger only
  new.reopened_count   := old.reopened_count;
  new.last_reopened_at := old.last_reopened_at;
  new.updated_at       := now();

  -- Reopen: a fixed issue losing its completed_at. Counted here so the client
  -- cannot forget to, and the previous fix stays in issue_events.
  if old.completed_at is not null and new.completed_at is null then
    new.started_at       := null;
    new.started_by_name  := null;
    new.completed_by_name := null;
    new.reopened_count   := old.reopened_count + 1;
    new.last_reopened_at := now();
  end if;

  -- Stamp who did what when a stage timestamp appears.
  if new.acknowledged_at is not null and old.acknowledged_at is null then
    new.acknowledged_by_name := coalesce(new.acknowledged_by_name, public._actor_name());
    new.acknowledged_by_id   := coalesce(new.acknowledged_by_id, public.my_id());
  end if;
  if new.started_at is not null and old.started_at is null then
    new.started_by_name := coalesce(new.started_by_name, public._actor_name());
  end if;
  if new.completed_at is not null and old.completed_at is null then
    new.completed_by_name := coalesce(new.completed_by_name, public._actor_name());
  end if;
  return new;
end $$;

drop trigger if exists issues_before_update on public.issues;
create trigger issues_before_update before update on public.issues
  for each row execute function public.issues_before_update();

create or replace function public.issues_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_area text := public._area_name(new.area_id);
begin
  perform public._event(new.id, 'reported', null, new.priority);
  perform public._alert('all', 'new', 'posted a new work order', v_area || ' — ' || new.title, new.id);
  -- Reporting a broken piece of equipment marks it broken: same fact, two places.
  if new.equipment_id is not null then
    update public.equipment set condition = 'broken', updated_at = now()
      where id = new.equipment_id and condition <> 'broken';
  end if;
  return new;
end $$;

drop trigger if exists issues_after_insert on public.issues;
create trigger issues_after_insert after insert on public.issues
  for each row execute function public.issues_after_insert();

create or replace function public.issues_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_area text := public._area_name(new.area_id);
  v_me   uuid := public.my_id();
begin
  -- Reopened (detected via the counter the before-trigger bumped)
  if new.reopened_count > old.reopened_count then
    perform public._event(new.id, 'reopened', 'fixed', 'reported');
    perform public._alert('all', 'warn', 'reopened the ' || v_area || ' work order',
      new.title || ' · fixed ' || new.reopened_count || ' time' || case when new.reopened_count = 1 then '' else 's' end || ' before', new.id);
  end if;

  if new.acknowledged_at is not null and old.acknowledged_at is null then
    perform public._event(new.id, 'acknowledged', null, null);
    perform public._alert('owner', 'good', 'saw the ' || v_area || ' work order', new.title, new.id);
  end if;

  if new.assigned_to_name is distinct from old.assigned_to_name and new.assigned_to_name is not null then
    perform public._event(new.id, 'assigned', old.assigned_to_name, new.assigned_to_name);
    if new.assigned_to_id is not null and new.assigned_to_id = v_me then
      perform public._alert('owner', 'good', 'took on the ' || v_area || ' work order', new.title, new.id);
    else
      perform public._alert('owner', 'good', 'assigned ' || v_area || ' to ' || new.assigned_to_name, new.title, new.id);
      if new.assigned_to_id is not null then
        perform public._alert('all', 'new', 'assigned you the ' || v_area || ' work order', new.title, new.id, null, new.assigned_to_id);
      end if;
    end if;
  end if;

  if new.started_at is not null and old.started_at is null then
    perform public._event(new.id, 'started', null, null);
    perform public._alert('owner', 'good', 'started work on ' || v_area, new.title, new.id);
  end if;

  if new.completed_at is not null and old.completed_at is null then
    perform public._event(new.id, 'fixed', null, new.resolution_note);
    perform public._alert('owner', 'good', 'marked ' || v_area || ' as fixed',
      coalesce(nullif(new.resolution_note, ''), new.title), new.id);
    if new.equipment_id is not null then
      update public.equipment set condition = 'working', updated_at = now()
        where id = new.equipment_id and condition = 'broken';
    end if;
  end if;

  if new.priority is distinct from old.priority then
    perform public._event(new.id, 'priority', old.priority, new.priority);
    perform public._alert('staff', 'new', 'marked ' || v_area || ' as ' || new.priority,
      'Was ' || old.priority || ' — ' || new.title, new.id);
  end if;

  if new.title is distinct from old.title or new.area_id is distinct from old.area_id
     or new.category is distinct from old.category then
    perform public._event(new.id, 'edited', old.title, new.title);
  end if;
  return new;
end $$;

drop trigger if exists issues_after_update on public.issues;
create trigger issues_after_update after update on public.issues
  for each row execute function public.issues_after_update();

-- photo_count is the only thing cards need; bytes never travel with lists.
create or replace function public.issue_photos_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.issues set photo_count = photo_count + 1 where id = new.issue_id;
  return new;
end $$;
drop trigger if exists issue_photos_after_insert on public.issue_photos;
create trigger issue_photos_after_insert after insert on public.issue_photos
  for each row execute function public.issue_photos_after_insert();

-- ---------------------------------------------------------------------------
-- equipment ↔ schedules: a service interval OWNS one schedule row.
-- ---------------------------------------------------------------------------
create or replace function public.equipment_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists equipment_touch on public.equipment;
create trigger equipment_touch before insert or update on public.equipment
  for each row execute function public.equipment_touch();

-- AFTER, not BEFORE: on insert the equipment row must exist before a schedule
-- can reference it.
create or replace function public.equipment_sync_schedule() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_due date;
begin
  if new.service_interval_months is not null and new.archived_at is null then
    v_due := (coalesce(new.last_serviced_at, current_date) + make_interval(months => new.service_interval_months))::date;
    if tg_op = 'UPDATE' then
      -- keep the generated row in step; recompute the due date only when its inputs moved
      update public.schedules set
        area_id = new.area_id,
        task = 'Service: ' || new.name,
        interval_months = new.service_interval_months,
        next_due_at = case when new.last_serviced_at is distinct from old.last_serviced_at
                            or new.service_interval_months is distinct from old.service_interval_months
                            or archived_at is not null
                           then v_due else next_due_at end,
        last_completed_at = coalesce(new.last_serviced_at, last_completed_at),
        archived_at = null
      where equipment_id = new.id;
      if found then return null; end if;
    end if;
    insert into public.schedules (area_id, equipment_id, task, interval_months, next_due_at, last_completed_at, created_by_name)
    values (new.area_id, new.id, 'Service: ' || new.name, new.service_interval_months, v_due, new.last_serviced_at, public._actor_name());
  elsif tg_op = 'UPDATE' then
    update public.schedules set archived_at = now() where equipment_id = new.id and archived_at is null;
  end if;
  return null;
end $$;

drop trigger if exists equipment_sync_schedule on public.equipment;
create trigger equipment_sync_schedule after insert or update on public.equipment
  for each row execute function public.equipment_sync_schedule();

-- ---------------------------------------------------------------------------
-- RPCs (the client's only write path for anything staff-role may not UPDATE
-- directly). Gate in the body + revoke below, every one.
-- ---------------------------------------------------------------------------

-- Staff may change condition / quantity / note / photo on any equipment
-- without an update policy on the table.
create or replace function public.set_equipment_state(
  p_id uuid, p_condition text default null, p_qty numeric default null,
  p_note text default null, p_photo_path text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_condition is not null and p_condition not in ('working', 'service due', 'broken') then
    raise exception 'bad condition';
  end if;
  update public.equipment set
    condition  = coalesce(p_condition, condition),
    qty        = coalesce(p_qty, qty),
    note       = coalesce(p_note, note),
    photo_path = coalesce(p_photo_path, photo_path)
  where id = p_id and archived_at is null;
  if not found then raise exception 'no such equipment'; end if;
end $$;
revoke execute on function public.set_equipment_state(uuid, text, numeric, text, text) from public, anon;
grant execute on function public.set_equipment_state(uuid, text, numeric, text, text) to authenticated;

-- Complete a scheduled task: logs the completion, rolls the due date, and
-- stamps the equipment it came from.
create or replace function public.complete_schedule(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.schedules%rowtype;
begin
  if not public.is_active_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into s from public.schedules where id = p_id and archived_at is null;
  if not found then raise exception 'no such schedule'; end if;
  insert into public.schedule_completions (schedule_id, completed_by_name, completed_by_id, note)
  values (p_id, public._actor_name(), public.my_id(), nullif(btrim(coalesce(p_note, '')), ''));
  update public.schedules set
    last_completed_at = current_date,
    next_due_at = (current_date + make_interval(months => s.interval_months))::date,
    due_alerted_for = null
  where id = p_id;
  if s.equipment_id is not null then
    update public.equipment set
      last_serviced_at = current_date,
      condition = case when condition = 'service due' then 'working' else condition end
    where id = s.equipment_id;
  end if;
  perform public._alert('owner', 'good', 'completed ' || s.task, public._area_name(s.area_id), null, p_id);
end $$;
revoke execute on function public.complete_schedule(uuid, text) from public, anon;
grant execute on function public.complete_schedule(uuid, text) to authenticated;

-- Raise "due" alerts for anything due within 7 days, once per due date.
-- Called by the client on every load; idempotent; no cron to forget.
create or replace function public.sync_due_alerts() returns int
language plpgsql security definer set search_path = public as $$
declare s record; n int := 0;
begin
  if not public.is_active_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  for s in
    select id, task, area_id, next_due_at from public.schedules
    where archived_at is null and next_due_at <= current_date + 7
      and (due_alerted_for is null or due_alerted_for <> next_due_at)
  loop
    insert into public.alerts (audience, kind, actor_name, actor_id, text, subtext, schedule_id)
    values ('all', 'warn', null, null,
      s.task || case when s.next_due_at < current_date then ' is overdue' else ' is due ' || to_char(s.next_due_at, 'Dy DD Mon') end,
      public._area_name(s.area_id), s.id);
    update public.schedules set due_alerted_for = s.next_due_at where id = s.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.sync_due_alerts() from public, anon;
grant execute on function public.sync_due_alerts() to authenticated;

-- Mark bought: every listed line at once (the shopping list groups identical
-- names), and remember the price for next time.
create or replace function public.acquire_items(p_ids uuid[], p_actual numeric default null, p_vendor text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.is_active_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.items set
    acquired = true, acquired_at = now(), acquired_by_name = public._actor_name(),
    actual_unit_price = coalesce(p_actual, actual_unit_price),
    vendor = coalesce(nullif(btrim(coalesce(p_vendor, '')), ''), vendor)
  where id = any(p_ids) and not acquired;
  if p_actual is not null then
    for r in select distinct name from public.items where id = any(p_ids) loop
      insert into public.item_catalog (name, name_key, last_actual_price, last_vendor, times_bought)
      values (btrim(r.name), lower(btrim(r.name)), p_actual, nullif(btrim(coalesce(p_vendor, '')), ''), 1)
      on conflict (name_key) do update set
        last_actual_price = excluded.last_actual_price,
        last_vendor = coalesce(excluded.last_vendor, public.item_catalog.last_vendor),
        times_bought = public.item_catalog.times_bought + 1,
        updated_at = now();
    end loop;
  end if;
end $$;
revoke execute on function public.acquire_items(uuid[], numeric, text) from public, anon;
grant execute on function public.acquire_items(uuid[], numeric, text) to authenticated;

create or replace function public.unacquire_items(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.items set acquired = false, acquired_at = null, acquired_by_name = null
  where id = any(p_ids) and acquired;
end $$;
revoke execute on function public.unacquire_items(uuid[]) from public, anon;
grant execute on function public.unacquire_items(uuid[]) to authenticated;

-- Restock a low consumable from the shopping list: bumps the quantity and
-- remembers the price under the equipment's name.
create or replace function public.restock_equipment(p_id uuid, p_added numeric, p_actual numeric default null, p_vendor text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not public.is_active_staff() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_added is null or p_added <= 0 then raise exception 'quantity must be positive'; end if;
  update public.equipment set qty = qty + p_added where id = p_id and archived_at is null
    returning name into v_name;
  if not found then raise exception 'no such equipment'; end if;
  if p_actual is not null then
    insert into public.item_catalog (name, name_key, last_actual_price, last_vendor, times_bought)
    values (btrim(v_name), lower(btrim(v_name)), p_actual, nullif(btrim(coalesce(p_vendor, '')), ''), 1)
    on conflict (name_key) do update set
      last_actual_price = excluded.last_actual_price,
      last_vendor = coalesce(excluded.last_vendor, public.item_catalog.last_vendor),
      times_bought = public.item_catalog.times_bought + 1,
      updated_at = now();
  end if;
end $$;
revoke execute on function public.restock_equipment(uuid, numeric, numeric, text) from public, anon;
grant execute on function public.restock_equipment(uuid, numeric, numeric, text) to authenticated;

-- Alerts: per-person read state, appended only.
create or replace function public.mark_alerts_read(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.my_id();
begin
  if v_me is null then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.alerts set read_by = array_append(read_by, v_me)
  where id = any(p_ids) and not (v_me = any(read_by));
end $$;
revoke execute on function public.mark_alerts_read(uuid[]) from public, anon;
grant execute on function public.mark_alerts_read(uuid[]) to authenticated;

-- Archive: one row per month, aggregated in SQL so it can never truncate.
-- Months cut in Asia/Manila.
create or replace function public.issues_months()
returns table (month text, fixed int, areas int)
language sql stable security definer set search_path = public as $$
  select to_char(completed_at at time zone 'Asia/Manila', 'YYYY-MM') as month,
         count(*)::int as fixed,
         count(distinct area_id)::int as areas
  from public.issues
  where completed_at is not null and public.is_active_staff()
  group by 1 order by 1 desc
$$;
revoke execute on function public.issues_months() from public, anon;
grant execute on function public.issues_months() to authenticated;
