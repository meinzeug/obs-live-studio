-- Live-Ereignisse sind Teil der Historie eines konkreten Broadcast-Runs. Beim
-- gezielten Entfernen eines Runs (Tests, Aufraeumen oder Rollback) duerfen
-- spaet eintreffende Runner-Ereignisse die Transaktion nicht blockieren.
alter table live_events
  drop constraint if exists live_events_broadcast_run_id_fkey;

alter table live_events
  add constraint live_events_broadcast_run_id_fkey
  foreign key (broadcast_run_id) references broadcast_runs(id) on delete cascade;
