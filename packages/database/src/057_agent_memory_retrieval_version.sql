alter table agent_memories
  add column if not exists retrieval_version text not null default 'fts-simple-v1';

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='agent_memories'::regclass
      and conname='agent_memory_retrieval_version_valid'
  ) then
    alter table agent_memories
      add constraint agent_memory_retrieval_version_valid
      check(retrieval_version ~ '^[a-z0-9][a-z0-9._-]{2,79}$');
  end if;
end;
$$;
