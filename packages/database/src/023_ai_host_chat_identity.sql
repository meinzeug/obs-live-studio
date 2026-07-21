do $$
declare
  previous_default text;
begin
  select column_default into previous_default
  from information_schema.columns
  where table_schema=current_schema()
    and table_name='ai_host_settings'
    and column_name='anonymize_authors';

  if previous_default is distinct from 'false' then
    update ai_host_settings
    set anonymize_authors=false,
        updated_at=now()
    where id=true;
  end if;
end $$;

alter table ai_host_settings
  alter column anonymize_authors set default false;
