alter table youtube_video_editor_sources
  drop constraint if exists youtube_video_editor_source_status_valid;
alter table youtube_video_editor_sources
  add constraint youtube_video_editor_source_status_valid
  check(status in ('remote','queued','downloading','ready','error','cancelled'));
