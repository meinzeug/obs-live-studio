-- Lebendige, aber redaktionell kontrollierte Rundenregie. Humor bleibt
-- beitragsbezogen und wird bei sensiblen Themen automatisch unterdrückt.

update ai_roundtable_settings
set production_settings=production_settings || jsonb_build_object(
      'humorLevel','lively',
      'banterEnabled',true,
      'duckYoutubeAudio',true,
      'youtubeDuckVolume',0.22
    ),
    updated_at=now()
where id=true;

update broadcast_templates
set settings=settings || jsonb_build_object(
      'roundtableHumorLevel',coalesce(settings->>'roundtableHumorLevel','lively'),
      'roundtableBanterEnabled',coalesce((settings->>'roundtableBanterEnabled')::boolean,true),
      'roundtableDuckYoutubeAudio',coalesce((settings->>'roundtableDuckYoutubeAudio')::boolean,true),
      'roundtableYoutubeDuckVolume',coalesce((settings->>'roundtableYoutubeDuckVolume')::numeric,0.22)
    ),
    updated_at=now()
where system_key in ('ai-roundtable-studio','ai-roundtable-fakten-duell','ai-roundtable-publikumsforum')
  and deleted_at is null;

update broadcast_playlists playlist
set settings=jsonb_set(
      playlist.settings,
      '{roundtableProductionSettings}',
      coalesce(playlist.settings->'roundtableProductionSettings','{}'::jsonb) || jsonb_build_object(
        'humorLevel',coalesce(format.settings->>'roundtableHumorLevel','lively'),
        'banterEnabled',coalesce((format.settings->>'roundtableBanterEnabled')::boolean,true),
        'duckYoutubeAudio',coalesce((format.settings->>'roundtableDuckYoutubeAudio')::boolean,true),
        'youtubeDuckVolume',coalesce((format.settings->>'roundtableYoutubeDuckVolume')::numeric,0.22)
      ),
      true
    )
from broadcast_templates format
where playlist.format_id=format.id
  and format.system_key in ('ai-roundtable-studio','ai-roundtable-fakten-duell','ai-roundtable-publikumsforum');

update broadcast_items item
set rules=jsonb_set(
      item.rules,
      '{roundtableProductionSettings}',
      coalesce(item.rules->'roundtableProductionSettings','{}'::jsonb) || jsonb_build_object(
        'humorLevel',coalesce(format.settings->>'roundtableHumorLevel','lively'),
        'banterEnabled',coalesce((format.settings->>'roundtableBanterEnabled')::boolean,true),
        'duckYoutubeAudio',coalesce((format.settings->>'roundtableDuckYoutubeAudio')::boolean,true),
        'youtubeDuckVolume',coalesce((format.settings->>'roundtableYoutubeDuckVolume')::numeric,0.22)
      ),
      true
    )
from broadcast_playlists playlist
join broadcast_templates format on format.id=playlist.format_id
where item.playlist_id=playlist.id
  and item.rules->>'kind'='youtube-context'
  and format.system_key in ('ai-roundtable-studio','ai-roundtable-fakten-duell','ai-roundtable-publikumsforum');
