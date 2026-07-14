create or replace function normalize_source_update_state()
returns trigger
language plpgsql
as $$
begin
  if new.user_agent = '' then
    new.user_agent := null;
  elsif new.user_agent is null and old.user_agent is not null then
    new.user_agent := old.user_agent;
  end if;

  if new.url is distinct from old.url then
    new.etag := null;
    new.last_modified := null;
    new.last_success_at := null;
    new.last_error := null;
    new.consecutive_errors := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists sources_reset_fetch_state_on_url_change on sources;
drop trigger if exists sources_normalize_update on sources;

create trigger sources_normalize_update
before update on sources
for each row
execute function normalize_source_update_state();
