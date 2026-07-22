update agent_orchestrator_settings
set safe_broadcast_mode=true,
    enabled=(mode <> 'stopped'),
    updated_at=now()
where safe_broadcast_mode is distinct from true
   or enabled is distinct from (mode <> 'stopped');

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='agent_orchestrator_settings'::regclass
      and conname='agent_orchestrator_mode_enabled_consistent'
  ) then
    alter table agent_orchestrator_settings
      add constraint agent_orchestrator_mode_enabled_consistent
      check(enabled = (mode <> 'stopped'));
  end if;
  if not exists(
    select 1 from pg_constraint
    where conrelid='agent_orchestrator_settings'::regclass
      and conname='agent_orchestrator_broadcast_isolation_required'
  ) then
    alter table agent_orchestrator_settings
      add constraint agent_orchestrator_broadcast_isolation_required
      check(safe_broadcast_mode);
  end if;
end;
$$;
