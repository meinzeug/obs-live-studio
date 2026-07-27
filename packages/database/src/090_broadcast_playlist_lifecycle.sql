-- Eine Sendung ist der fachliche Besitzer ihrer Rundown-Punkte und historischen
-- Ausspielungen. Beim bewussten Löschen werden diese abhängigen Datensätze
-- gemeinsam entfernt; laufende Sendungen werden bereits in der Anwendung
-- blockiert.
alter table broadcast_items
  drop constraint if exists broadcast_items_playlist_id_fkey;
alter table broadcast_items
  add constraint broadcast_items_playlist_id_fkey
  foreign key(playlist_id) references broadcast_playlists(id) on delete cascade;

alter table broadcast_runs
  drop constraint if exists broadcast_runs_playlist_id_fkey;
alter table broadcast_runs
  add constraint broadcast_runs_playlist_id_fkey
  foreign key(playlist_id) references broadcast_playlists(id) on delete cascade;

-- Ein realer Sendezeitpunkt darf nur genau eine aktive Autopilot-Sendung
-- besitzen. Bei älteren Planständen gewinnt eine bereits laufende Sendung,
-- ansonsten der zuletzt erstellte Plan.
with ranked as (
  select id,
         row_number() over(
           partition by scheduled_at
           order by
             case status when 'running' then 0 when 'starting' then 1 when 'paused' then 2 else 3 end,
             created_at desc,
             id desc
         ) slot_rank
  from broadcast_playlists
  where scheduled_at is not null
    and coalesce((settings->>'autopilot24h')::boolean,false)=true
    and status in ('draft','starting','running','paused')
)
update broadcast_playlists playlist
set status='interrupted',
    ended_at=coalesce(ended_at,now()),
    settings=jsonb_set(
      coalesce(playlist.settings,'{}'::jsonb),
      '{scheduleReconciliation}',
      '"duplicate-time-slot-superseded"'::jsonb,
      true
    )
from ranked
where playlist.id=ranked.id and ranked.slot_rank>1;

drop index if exists idx_autopilot_active_format_slot;

create unique index if not exists idx_autopilot_active_time_slot
  on broadcast_playlists(scheduled_at)
  where scheduled_at is not null
    and coalesce((settings->>'autopilot24h')::boolean,false)=true
    and status in ('draft','starting','running','paused');
