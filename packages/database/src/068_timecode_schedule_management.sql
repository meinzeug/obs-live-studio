-- Der Autopilot darf einen Format-Slot nur einmal gleichzeitig bereitstellen.
with ranked as (
  select id,
         row_number() over(
           partition by scheduled_at,settings->>'autopilotFormatId'
           order by
             case status when 'running' then 0 when 'starting' then 1 when 'paused' then 2 else 3 end,
             created_at desc
         ) slot_rank
  from broadcast_playlists
  where scheduled_at is not null
    and coalesce((settings->>'autopilot24h')::boolean,false)=true
    and settings->>'autopilotFormatId' is not null
    and status in ('draft','starting','running','paused')
)
update broadcast_playlists playlist
set status='interrupted',
    ended_at=coalesce(ended_at,now()),
    settings=jsonb_set(
      coalesce(playlist.settings,'{}'::jsonb),
      '{scheduleReconciliation}',
      '"duplicate-slot-superseded"'::jsonb,
      true
    )
from ranked
where playlist.id=ranked.id and ranked.slot_rank>1;

create unique index if not exists idx_autopilot_active_format_slot
  on broadcast_playlists(scheduled_at,(settings->>'autopilotFormatId'))
  where scheduled_at is not null
    and coalesce((settings->>'autopilot24h')::boolean,false)=true
    and settings->>'autopilotFormatId' is not null
    and status in ('draft','starting','running','paused');

create table if not exists broadcast_schedule_health(
  id boolean primary key default true check(id),
  status text not null default 'unknown' check(status in ('healthy','handoff','late','idle','stream-wait','error','unknown')),
  current_playlist_id uuid references broadcast_playlists(id) on delete set null,
  due_playlist_id uuid references broadcast_playlists(id) on delete set null,
  next_playlist_id uuid references broadcast_playlists(id) on delete set null,
  delay_seconds integer not null default 0,
  skipped_backlog integer not null default 0,
  details jsonb not null default '{}',
  checked_at timestamptz not null default now()
);

insert into broadcast_schedule_health(id) values(true) on conflict(id) do nothing;
