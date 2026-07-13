alter table broadcast_recovery_operations add column if not exists requested_by_user_id uuid;
alter table broadcast_recovery_operations add column if not exists idempotency_scope text;
alter table broadcast_recovery_operations add column if not exists start_snapshot jsonb;

update broadcast_recovery_operations
set idempotency_scope=coalesce(idempotency_scope, case when requested_by_user_id is not null then 'user:' || requested_by_user_id::text end, case when requested_by is not null then 'system:' || requested_by end, 'system:anonymous')
where idempotency_scope is null;

update broadcast_recovery_operations o
set requested_by_user_id=null
where requested_by_user_id is not null
  and not exists(select 1 from users u where u.id=o.requested_by_user_id);

alter table broadcast_recovery_operations alter column idempotency_scope set not null;
alter table broadcast_recovery_operations alter column idempotency_scope drop default;
alter table broadcast_recovery_operations drop constraint if exists broadcast_recovery_operations_requested_by_user_id_fkey;
alter table broadcast_recovery_operations add constraint broadcast_recovery_operations_requested_by_user_id_fkey foreign key (requested_by_user_id) references users(id) on delete set null;

drop index if exists idx_broadcast_start_idempotency;
drop index if exists idx_broadcast_recovery_idempotency;

create unique index if not exists idx_broadcast_start_idempotency_scoped
  on broadcast_recovery_operations(operation_type,idempotency_scope,idempotency_key)
  where operation_type='start' and idempotency_key is not null;
