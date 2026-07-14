create or replace function reset_source_fetch_state_on_url_change()
returns trigger
language plpgsql
as $$
begin
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

create trigger sources_reset_fetch_state_on_url_change
before update of url on sources
for each row
execute function reset_source_fetch_state_on_url_change();
