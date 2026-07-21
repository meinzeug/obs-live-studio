-- Zeitmarken aus den echten YouTube-Untertiteln ermöglichen es der Redaktion,
-- AVAs Moderationspausen hinter die jeweils besprochene Passage zu setzen.
alter table youtube_videos
  add column if not exists transcript_segments jsonb not null default '[]'::jsonb;

update youtube_videos
set transcript_segments='[]'::jsonb
where transcript_segments is null or jsonb_typeof(transcript_segments) <> 'array';
