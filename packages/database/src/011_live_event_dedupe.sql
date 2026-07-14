create or replace function normalize_live_event_dedupe_key()
returns trigger
language plpgsql
as $$
declare
  v_project_id uuid;
  v_rotated_at timestamptz;
begin
  if new.type = 'overlay-published' and new.overlay_version_id is not null then
    new.dedupe_key := 'overlay-published:' || new.overlay_version_id::text;
  elsif new.type = 'overlay-version-changed'
    and new.payload ->> 'reason' = 'token-rotated'
    and coalesce(new.payload ->> 'projectId', '') <> '' then
    begin
      v_project_id := (new.payload ->> 'projectId')::uuid;
    exception when invalid_text_representation then
      v_project_id := null;
    end;

    if v_project_id is not null then
      select public_token_created_at
      into v_rotated_at
      from overlay_projects
      where id = v_project_id;

      if v_rotated_at is not null then
        new.dedupe_key :=
          'overlay-token-rotated:' || v_project_id::text || ':' ||
          floor(extract(epoch from v_rotated_at) * 1000000)::bigint::text;
      end if;
    end if;
  end if;

  return new;
end;
$$;

delete from live_events duplicate
using live_events keeper
where duplicate.type = 'overlay-published'
  and keeper.type = duplicate.type
  and duplicate.overlay_version_id is not null
  and keeper.overlay_version_id = duplicate.overlay_version_id
  and duplicate.id > keeper.id;

update live_events
set dedupe_key = 'overlay-published:' || overlay_version_id::text
where type = 'overlay-published'
  and overlay_version_id is not null
  and dedupe_key is distinct from 'overlay-published:' || overlay_version_id::text;

drop trigger if exists live_events_normalize_dedupe_key on live_events;

create trigger live_events_normalize_dedupe_key
before insert on live_events
for each row
execute function normalize_live_event_dedupe_key();
