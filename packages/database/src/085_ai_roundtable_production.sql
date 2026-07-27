-- Produktionsregie für automatisch ausgespielte KI-Runden. Das JSON-Feld hält
-- bewusst nur redaktionelle/visuelle Optionen; Laufzeitdaten bleiben in klaren
-- Spalten und können vom Runner atomar aktualisiert werden.

alter table ai_roundtable_settings
  add column if not exists production_settings jsonb not null default jsonb_build_object(
    'introductionsEnabled',true,
    'showAllParticipants',true,
    'autoDiscussVideos',true,
    'videoLayout','video-left',
    'fallbackMode','local-editorial',
    'minimumParticipants',6
  ),
  add column if not exists show_session_key text,
  add column if not exists active_item_id uuid,
  add column if not exists introduction_complete boolean not null default false,
  add column if not exists video_context jsonb not null default '{}'::jsonb;

update ai_roundtable_settings
set participant_ids=array[
      'moderator','chat-moderator','presenter-lea','presenter-leon','presenter-jonas','presenter-karim'
    ],
    production_settings=production_settings || jsonb_build_object(
      'introductionsEnabled',true,
      'showAllParticipants',true,
      'autoDiscussVideos',true,
      'videoLayout','video-left',
      'fallbackMode','local-editorial',
      'minimumParticipants',6
    ),
    updated_at=now()
where id=true;

update broadcast_templates
set settings=settings || jsonb_build_object(
      'aiRoundtable',true,
      'roundtablePreset',coalesce(settings->>'roundtablePreset','studio-rundtisch'),
      'roundtableParticipantIds',jsonb_build_array(
        'moderator','chat-moderator','presenter-lea','presenter-leon','presenter-jonas','presenter-karim'
      ),
      'roundtableIntroductions',true,
      'roundtableAutoDiscussVideos',true,
      'roundtableFallbackMode','local-editorial',
      'youtubeContextLayoutVariant','ai-roundtable'
    ),
    flow=flow || jsonb_build_object(
      'introductionRound',true,
      'videoSequence',true,
      'discussionBetweenVideos',true,
      'localFallback',true
    ),
    updated_at=now()
where system_key in ('ai-roundtable-studio','ai-roundtable-fakten-duell','ai-roundtable-publikumsforum')
  and deleted_at is null;

update broadcast_playlists playlist
set settings=playlist.settings || jsonb_build_object(
      'aiRoundtable',true,
      'roundtablePreset',coalesce(format.settings->>'roundtablePreset','studio-rundtisch'),
      'roundtableParticipantIds',format.settings->'roundtableParticipantIds',
      'roundtableProductionSettings',jsonb_build_object(
        'introductionsEnabled',true,
        'showAllParticipants',true,
        'autoDiscussVideos',true,
        'videoLayout','video-left',
        'fallbackMode','local-editorial',
        'minimumParticipants',6
      )
    )
from broadcast_templates format
where playlist.format_id=format.id
  and format.system_key in ('ai-roundtable-studio','ai-roundtable-fakten-duell','ai-roundtable-publikumsforum');

update broadcast_items item
set rules=item.rules || jsonb_build_object(
      'aiRoundtable',true,
      'roundtablePreset',coalesce(format.settings->>'roundtablePreset','studio-rundtisch'),
      'roundtableParticipantIds',format.settings->'roundtableParticipantIds',
      'roundtableProductionSettings',jsonb_build_object(
        'introductionsEnabled',true,
        'showAllParticipants',true,
        'autoDiscussVideos',true,
        'videoLayout','video-left',
        'fallbackMode','local-editorial',
        'minimumParticipants',6
      ),
      'contextLayoutVariant','ai-roundtable',
      'formatSystemKey',format.system_key
    )
from broadcast_playlists playlist
join broadcast_templates format on format.id=playlist.format_id
where item.playlist_id=playlist.id
  and item.rules->>'kind'='youtube-context'
  and format.system_key in ('ai-roundtable-studio','ai-roundtable-fakten-duell','ai-roundtable-publikumsforum');

update overlay_projects
set obs_scene_name='21_AI_ROUNDTABLE',
    obs_input_name='ANS_AI_ROUNDTABLE_OVERLAY',
    public_url='/overlay/ai-roundtable',
    obs_configured_url='/overlay/ai-roundtable',
    obs_configured_at=now()
where deleted_at is null and template='ai-roundtable';
