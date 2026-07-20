alter table ai_host_settings
  add column if not exists chat_source_mode text not null default 'channel';

do $$
begin
  if not exists(select 1 from pg_constraint where conname='ai_host_chat_source_mode_valid') then
    alter table ai_host_settings add constraint ai_host_chat_source_mode_valid
      check(chat_source_mode in ('channel','content'));
  end if;
end $$;

-- Migration 012 behandelte historische YouTube-Beiträge ohne article_id wie
-- Nachrichten ohne Bildmaterial. Sie sind selbst die visuelle Quelle und
-- müssen deshalb für noch nicht gestartete Sendungen wieder spielbar werden.
update broadcast_items bi
set status='planned',error=null
from broadcast_playlists bp
where bp.id=bi.playlist_id
  and bp.status='draft'
  and bi.article_id is null
  and bi.rules->>'kind' in ('youtube-video','youtube-news-sidebar')
  and bi.status='error'
  and bi.error='Kein freigegebenes Video oder Bild/Grafik für diesen Beitrag vorhanden';
