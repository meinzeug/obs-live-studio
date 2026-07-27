-- Verbindet jede Wortmeldung der KI-Runde mit der konkreten Transkriptstelle,
-- an der die Regie das YouTube-Video anhält. Die Zuordnung bleibt auch bei
-- Prozessneustarts nachvollziehbar und ermöglicht zusammenhängende Cue-Gruppen.

alter table ai_roundtable_turns
  add column if not exists preproduced_cue_id uuid references youtube_preproduced_cues(id) on delete set null,
  add column if not exists preproduced_run_key text,
  add column if not exists video_pause_ms bigint,
  add column if not exists source_start_ms bigint,
  add column if not exists source_end_ms bigint,
  add column if not exists audience_message_id uuid references ai_host_chat_messages(id) on delete set null;

create index if not exists idx_ai_roundtable_turns_preproduced_cue
  on ai_roundtable_turns(preproduced_cue_id)
  where preproduced_cue_id is not null;

create unique index if not exists idx_ai_roundtable_turns_audience_message
  on ai_roundtable_turns(audience_message_id)
  where audience_message_id is not null;

create index if not exists idx_youtube_preproduced_cue_runs_group
  on youtube_preproduced_cue_runs(run_key,cue_id,status);
