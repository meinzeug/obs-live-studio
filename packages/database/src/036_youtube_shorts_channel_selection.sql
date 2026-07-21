-- Upload-Ziele werden als OAuth-Profile in der geschützten Serverumgebung
-- verwaltet. In der Datenbank liegt ausschließlich die nicht geheime
-- YouTube-Kanal-ID, die der Shorts-Automation als Ziel dient.
alter table youtube_shorts_settings
  add column if not exists youtube_channel_id text not null default '';
