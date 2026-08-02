create or replace function youtube_preproduced_script_is_broadcast_ready(candidate_id uuid)
returns boolean
language sql
stable
as $$
  select exists(
    select 1
    from youtube_preproduced_scripts script
    join youtube_videos video on video.id=script.youtube_video_id
    where script.id=candidate_id
      and script.status='ready'
      and script.generator_version='codex-cli-complete-show-discussion-20-40-v2'
      and script.production_model like 'codex-cli%'
      and script.cue_count>=6
      and coalesce(video.duration_seconds,0)>0
      and abs(script.duration_ms-video.duration_seconds*1000)<=2000
      and (select count(*) from youtube_preproduced_cues cue where cue.script_id=script.id)=script.cue_count
      and (select min(cue.at_ms) from youtube_preproduced_cues cue where cue.script_id=script.id)=0
      and (select max(cue.at_ms) from youtube_preproduced_cues cue where cue.script_id=script.id)
            < video.duration_seconds*1000
      and (select max(cue.at_ms) from youtube_preproduced_cues cue where cue.script_id=script.id)
            >=greatest(0,video.duration_seconds*1000-40000)
      and not exists(
        select 1
        from youtube_preproduced_cues cue
        where cue.script_id=script.id
          and (
            coalesce(cue.audio_path,'')='' or coalesce(cue.audio_duration_seconds,0)<=0
            or cue.ai_tier<>'codex' or cue.ai_model not like 'codex-cli%'
            or cue.discussion_move is null
            or (cue.presenter_id<>'translator' and cue.kind<>'intro' and cue.responds_to_presenter_id is null)
            or (cue.presenter_id<>'translator' and cue.kind<>'closing' and cue.handoff_to_presenter_id is null)
            or (cue.presenter_id='translator' and cue.kind<>'translation')
          )
      )
      and not exists(
        select 1
        from (
          select point.at_ms,lag(point.at_ms) over(order by point.at_ms) previous_at_ms
          from (select distinct cue.at_ms from youtube_preproduced_cues cue where cue.script_id=script.id) point
        ) spacing
        where spacing.previous_at_ms is not null
          and spacing.at_ms-spacing.previous_at_ms not between 20000 and 40000
      )
      and 6=(
        select count(distinct cue.presenter_id)
        from youtube_preproduced_cues cue
        where cue.script_id=script.id
          and cue.presenter_id in (
            'moderator','presenter-leon','presenter-lea','presenter-jonas','chat-moderator','presenter-karim'
          )
      )
      and (
        coalesce(video.source_language,'de') ~* '^de([_-]|$)'
        or not exists(
          select 1
          from (select distinct cue.at_ms from youtube_preproduced_cues cue where cue.script_id=script.id) point
          where not exists(
            select 1 from youtube_preproduced_cues translation
            where translation.script_id=script.id
              and translation.at_ms=point.at_ms
              and translation.presenter_id='translator'
              and translation.kind='translation'
          )
        )
      )
  )
$$;

update youtube_preproduced_scripts script
set status='partial',
    error='Neuproduktion erforderlich: Paketlaufzeit, vollständige Cue-Ausspielung oder deutsche Übersetzung ist nicht sendefähig.',
    updated_at=now()
where status in ('ready','processing')
  and not youtube_preproduced_script_is_broadcast_ready(script.id);
