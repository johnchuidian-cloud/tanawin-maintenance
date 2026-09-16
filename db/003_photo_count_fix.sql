-- 003: let the photo counter move.
-- issues_before_update froze photo_count along with the origin fields, which
-- also blocked the issue_photos trigger's own UPDATE — so the counter stayed at
-- 0 forever (found on the first real upload, 2026-09-16). photo_count is a
-- display convenience; a tampered value harms nothing, so it simply follows
-- the photos trigger now. Everything else in the function is unchanged.
create or replace function public.issues_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.reported_by_name := old.reported_by_name;
  new.reported_by_id   := old.reported_by_id;
  new.reported_at      := old.reported_at;
  new.reopened_count   := old.reopened_count;
  new.last_reopened_at := old.last_reopened_at;
  new.updated_at       := now();

  if old.completed_at is not null and new.completed_at is null then
    new.started_at        := null;
    new.started_by_name   := null;
    new.completed_by_name := null;
    new.reopened_count    := old.reopened_count + 1;
    new.last_reopened_at  := now();
  end if;

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
-- trigger functions are never called by clients, but CREATE OR REPLACE re-grants:
revoke execute on function public.issues_before_update() from public, anon, authenticated;

-- repair any counter that was frozen before this fix
update public.issues i set photo_count = (select count(*) from public.issue_photos p where p.issue_id = i.id)
where photo_count <> (select count(*) from public.issue_photos p where p.issue_id = i.id);
