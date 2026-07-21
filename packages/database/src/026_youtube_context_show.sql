alter table youtube_videos
  add column if not exists transcript_text text,
  add column if not exists transcript_language text,
  add column if not exists transcript_source text,
  add column if not exists transcript_status text not null default 'pending',
  add column if not exists transcript_error text,
  add column if not exists transcript_fetched_at timestamptz,
  add column if not exists editorial_analysis jsonb,
  add column if not exists editorial_analysis_status text not null default 'pending',
  add column if not exists editorial_analysis_model text,
  add column if not exists editorial_analysis_error text,
  add column if not exists editorial_analyzed_at timestamptz;

create index if not exists idx_youtube_videos_editorial_analysis
  on youtube_videos(editorial_analysis_status,updated_at desc)
  where deleted_at is null and enabled=true;

create index if not exists idx_broadcast_items_youtube_context
  on broadcast_items((rules->>'youtubeVideoId'))
  where rules->>'kind'='youtube-context';

alter table ai_host_sessions
  add column if not exists format_kind text not null default 'youtube-video';

create table if not exists youtube_context_playback_controls(
  broadcast_item_id uuid primary key references broadcast_items(id) on delete cascade,
  paused boolean not null default false,
  pause_started_at timestamptz,
  accumulated_pause_ms bigint not null default 0,
  active_turn_id uuid references ai_staff_turns(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Ein API-/Browser-Neustart darf kein Video dauerhaft angehalten lassen.
update youtube_context_playback_controls
set paused=false,
    accumulated_pause_ms=accumulated_pause_ms+
      case when pause_started_at is null then 0 else greatest(0,extract(epoch from (now()-pause_started_at))*1000)::bigint end,
    pause_started_at=null,
    active_turn_id=null,
    updated_at=now()
where paused=true;
