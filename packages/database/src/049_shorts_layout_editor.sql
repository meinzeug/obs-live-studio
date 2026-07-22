-- Visuelle 9:16-Layouts werden pro Zielplattform gespeichert. Die Worker
-- normalisieren ältere oder unvollständige Dokumente zusätzlich vor jedem
-- Render, damit ein UI-Fehler niemals die Produktionswarteschlange blockiert.
alter table youtube_shorts_settings
  add column if not exists layout_config jsonb not null default
  '{"version":1,"backgroundStyle":"blur","accentColor":"#22d3ee","brandingOverlayVisible":true,"elements":{"sourceVideo":{"visible":true,"x":40,"y":270,"width":1000,"height":562,"fit":"contain","borderWidth":4},"avatar":{"visible":true,"x":0,"y":1350,"width":900,"height":570,"fit":"contain","borderWidth":0},"formatLabel":{"visible":false,"x":72,"y":842,"width":936,"height":42,"fontFamily":"ibm-plex-sans","fontSize":28,"fontWeight":"bold","color":"#22d3ee","align":"left","background":"none","text":"AVA ORDNET EIN"},"title":{"visible":true,"x":72,"y":878,"width":936,"height":205,"fontFamily":"ibm-plex-sans","fontSize":42,"fontWeight":"bold","color":"#ffffff","align":"left","background":"glass"},"commentary":{"visible":true,"x":72,"y":1110,"width":936,"height":220,"fontFamily":"ibm-plex-sans","fontSize":31,"fontWeight":"bold","color":"#e2e8f0","align":"left","background":"none"},"source":{"visible":false,"x":72,"y":1300,"width":936,"height":42,"fontFamily":"ibm-plex-sans","fontSize":24,"fontWeight":"semibold","color":"#94a3b8","align":"left","background":"none"}}}'::jsonb;

alter table tiktok_shorts_settings
  add column if not exists layout_config jsonb not null default
  '{"version":1,"backgroundStyle":"studio","accentColor":"#25f4ee","brandingOverlayVisible":false,"elements":{"sourceVideo":{"visible":true,"x":40,"y":190,"width":1000,"height":562,"fit":"contain","borderWidth":4},"avatar":{"visible":true,"x":80,"y":1310,"width":920,"height":610,"fit":"contain","borderWidth":0},"formatLabel":{"visible":true,"x":70,"y":800,"width":940,"height":48,"fontFamily":"ibm-plex-sans","fontSize":31,"fontWeight":"bold","color":"#25f4ee","align":"left","background":"none","text":"AVA ORDNET EIN"},"title":{"visible":true,"x":70,"y":855,"width":940,"height":176,"fontFamily":"ibm-plex-sans","fontSize":43,"fontWeight":"bold","color":"#ffffff","align":"left","background":"glass"},"commentary":{"visible":true,"x":70,"y":1040,"width":940,"height":190,"fontFamily":"ibm-plex-sans","fontSize":30,"fontWeight":"bold","color":"#e2e8f0","align":"left","background":"none"},"source":{"visible":true,"x":70,"y":1245,"width":940,"height":44,"fontFamily":"ibm-plex-sans","fontSize":24,"fontWeight":"semibold","color":"#94a3b8","align":"left","background":"none"}}}'::jsonb;

alter table youtube_shorts_settings drop constraint if exists youtube_shorts_layout_config_valid;
alter table youtube_shorts_settings add constraint youtube_shorts_layout_config_valid
  check(jsonb_typeof(layout_config)='object' and layout_config->>'version'='1' and jsonb_typeof(layout_config->'elements')='object');

alter table tiktok_shorts_settings drop constraint if exists tiktok_shorts_layout_config_valid;
alter table tiktok_shorts_settings add constraint tiktok_shorts_layout_config_valid
  check(jsonb_typeof(layout_config)='object' and layout_config->>'version'='1' and jsonb_typeof(layout_config->'elements')='object');
