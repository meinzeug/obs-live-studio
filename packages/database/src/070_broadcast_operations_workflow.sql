-- Sendungsplanung und Regie teilen sich einen redaktionellen Arbeitszustand.
-- Der technische Runner-Status bleibt unverändert, damit bestehende Läufe und
-- der Autopilot abwärtskompatibel bleiben.
alter table broadcast_playlists
  add column if not exists production_status text not null default 'draft',
  add column if not exists readiness_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists readiness_checked_at timestamptz,
  add column if not exists prepared_at timestamptz,
  add column if not exists prepared_by uuid references users(id) on delete set null;

alter table broadcast_playlists drop constraint if exists broadcast_playlists_production_status_check;
alter table broadcast_playlists add constraint broadcast_playlists_production_status_check
  check(production_status in (
    'draft','incomplete','ready','scheduled','prepared','on_air','completed','error'
  ));

update broadcast_playlists
set production_status=case
  when status in ('starting','running','paused','stopping','recovering') then 'on_air'
  when status='ended' then 'completed'
  when status='error' then 'error'
  when scheduled_at is not null then 'scheduled'
  else 'draft'
end
where production_status='draft';

create index if not exists idx_broadcast_playlists_production
  on broadcast_playlists(production_status,scheduled_at);

create or replace function sync_broadcast_production_status()
returns trigger language plpgsql as $$
begin
  if new.status in ('starting','running','paused','stopping','recovering') then
    new.production_status := 'on_air';
  elsif new.status='ended' then
    new.production_status := 'completed';
  elsif new.status='error' then
    new.production_status := 'error';
  elsif old.status in ('starting','running','paused','stopping','recovering')
        and new.status='interrupted' then
    new.production_status := case when new.scheduled_at is null then 'ready' else 'scheduled' end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_broadcast_production_status on broadcast_playlists;
create trigger trg_broadcast_production_status
before update of status on broadcast_playlists
for each row execute function sync_broadcast_production_status();

-- Eine Live-Unterbrechung merkt sich, welches Programm pausiert wurde. Dadurch
-- kann die Regie später explizit an der Position, beim nächsten Beitrag, bei
-- der nächsten Sendung oder gar nicht zurückkehren.
create table if not exists broadcast_live_interruptions(
  id uuid primary key default gen_random_uuid(),
  status text not null default 'active'
    check(status in ('active','returned','cancelled','error')),
  kind text not null default 'live'
    check(kind in ('live','breaking')),
  source_run_id uuid references broadcast_runs(id) on delete set null,
  source_playlist_id uuid references broadcast_playlists(id) on delete set null,
  source_item_id uuid references broadcast_items(id) on delete set null,
  source_position integer,
  source_playback_status text,
  autopilot_was_enabled boolean not null default false,
  autopilot_was_paused boolean not null default false,
  return_strategy text
    check(return_strategy is null or return_strategy in ('resume-position','next-item','next-show','standby')),
  return_playlist_id uuid references broadcast_playlists(id) on delete set null,
  initiated_by uuid references users(id) on delete set null,
  returned_by uuid references users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  returned_at timestamptz
);

create unique index if not exists idx_single_active_live_interruption
  on broadcast_live_interruptions((true)) where status='active';
create index if not exists idx_live_interruptions_started
  on broadcast_live_interruptions(started_at desc);
