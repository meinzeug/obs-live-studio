alter table broadcast_recovery_operations add column if not exists requested_by_user_id uuid;
alter table broadcast_recovery_operations add column if not exists idempotency_scope text;
alter table broadcast_recovery_operations add column if not exists start_snapshot jsonb;

update broadcast_recovery_operations
set idempotency_scope=coalesce(idempotency_scope, requested_by_user_id::text, requested_by, 'anonymous')
where idempotency_scope is null;

alter table broadcast_recovery_operations alter column idempotency_scope set default 'anonymous';

drop index if exists idx_broadcast_start_idempotency;
drop index if exists idx_broadcast_recovery_idempotency;

create unique index if not exists idx_broadcast_start_idempotency_scoped
  on broadcast_recovery_operations(operation_type,idempotency_scope,idempotency_key)
  where operation_type='start' and idempotency_key is not null;
