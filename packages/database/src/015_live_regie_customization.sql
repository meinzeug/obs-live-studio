alter table live_studio_settings
  add column if not exists overlay_visible boolean not null default true,
  add column if not exists source_transition text not null default 'fade',
  add column if not exists source_transition_duration_ms integer not null default 650,
  add column if not exists source_auto_layout boolean not null default true,
  add column if not exists source_overlay_enabled boolean not null default true,
  add column if not exists source_label_style text not null default 'lower-third',
  add column if not exists stinger_settings jsonb not null default '{
    "live-now": {
      "enabled": true,
      "durationMs": 3200,
      "kicker": "LIVE",
      "title": "LIVE SENDUNG JETZT",
      "subtitle": "Wir schalten direkt ins Studio.",
      "accentColor": "#d20a2e",
      "animation": "sweep",
      "soundEnabled": true,
      "volume": 65
    },
    "breaking-news": {
      "enabled": true,
      "durationMs": 3000,
      "kicker": "BREAKING NEWS",
      "title": "EILMELDUNG",
      "subtitle": "Aktuelle Entwicklung live.",
      "accentColor": "#ffbf00",
      "animation": "glitch",
      "soundEnabled": true,
      "volume": 72
    },
    "back-to-program": {
      "enabled": true,
      "durationMs": 2600,
      "kicker": "PROGRAMM",
      "title": "ZURÜCK ZUR SENDUNG",
      "subtitle": "Der Autopilot übernimmt wieder.",
      "accentColor": "#16a34a",
      "animation": "zoom",
      "soundEnabled": true,
      "volume": 58
    }
  }'::jsonb;

alter table live_studio_settings
  drop constraint if exists live_studio_source_transition_valid;

alter table live_studio_settings
  add constraint live_studio_source_transition_valid
  check (source_transition=any('{cut,fade,slide,zoom,wipe}'::text[]));

alter table live_studio_settings
  drop constraint if exists live_studio_source_transition_duration_valid;

alter table live_studio_settings
  add constraint live_studio_source_transition_duration_valid
  check (source_transition_duration_ms between 0 and 3000);

alter table live_studio_settings
  drop constraint if exists live_studio_source_label_style_valid;

alter table live_studio_settings
  add constraint live_studio_source_label_style_valid
  check (source_label_style=any('{lower-third,badge,minimal}'::text[]));
