-- Der Sender behandelt ausschließlich Themen des aktuellen deutschen
-- Kalendertags. Der Veröffentlichungstag ist ein technisches Playout-Gate;
-- Codex prüft zusätzlich, ob tatsächlich eine neue Tagesentwicklung vorliegt.

insert into system_settings(key,value,updated_at)
values(
  'newsroom.current-topics-policy',
  jsonb_build_object(
    'enabled',true,
    'timeZone','Europe/Berlin',
    'calendarDayOnly',true,
    'requireSameDayVideoPublication',true,
    'requireSameDayArticleEvidence',true,
    'rejectEvergreenWithoutTodayDevelopment',true
  ),
  now()
)
on conflict(key) do update
set value=excluded.value,updated_at=now();

insert into system_settings(key,value,updated_at)
values(
  'studio.editorial-profile',
  jsonb_build_object(
    'currentTopicsOnly',true,
    'currentTopicsTimeZone','Europe/Berlin',
    'sameDayVideoAndArticleRequired',true
  ),
  now()
)
on conflict(key) do update
set value=system_settings.value || excluded.value,updated_at=now();

update broadcast_templates
set settings=settings || jsonb_build_object(
      'currentTopicsOnly',true,
      'currentTopicsTimeZone','Europe/Berlin',
      'sameDayVideoAndArticleRequired',true
    ),
    updated_at=now()
where active=true and deleted_at is null;

update broadcast_playlists playlist
set status='interrupted',
    ended_at=coalesce(playlist.ended_at,now()),
    settings=jsonb_set(
      coalesce(playlist.settings,'{}'::jsonb),
      '{scheduleReconciliation}',
      '"expired-non-current-topic"'::jsonb,
      true
    )
where playlist.status='draft'
  and exists(
    select 1
    from broadcast_items item
    left join youtube_videos video on video.id::text=item.rules->>'youtubeLibraryId'
    where item.playlist_id=playlist.id
      and item.rules->>'kind' in ('youtube-video','youtube-news-sidebar','youtube-context')
      and (
        video.id is null
        or video.published_at<date_trunc('day',now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin'
        or video.published_at>=now()+interval '15 minutes'
      )
  );

update broadcast_items item
set rules=jsonb_set(
      item.rules,
      '{news}',
      coalesce((
        select jsonb_agg(entry.value order by entry.ordinality)
        from jsonb_array_elements(coalesce(item.rules->'news','[]'::jsonb)) with ordinality entry(value,ordinality)
        join articles article on article.id::text=entry.value->>'articleId'
        where coalesce(article.published_at,article.fetched_at)>=date_trunc('day',now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin'
          and coalesce(article.published_at,article.fetched_at)<now()+interval '15 minutes'
      ),'[]'::jsonb),
      true
    )
from broadcast_playlists playlist
where playlist.id=item.playlist_id
  and playlist.status in ('draft','starting','running','paused','recovering')
  and item.rules->>'kind'='youtube-context'
  and jsonb_typeof(item.rules->'news')='array';

update codex_newsroom_plans
set status='superseded',superseded_at=coalesce(superseded_at,now()),updated_at=now()
where status='active'
  and coalesce(plan->>'decision','')<>'ready';
