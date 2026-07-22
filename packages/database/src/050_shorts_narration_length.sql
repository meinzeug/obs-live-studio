-- Die gewünschte AVA-Sprechlänge gilt für die gemeinsame Premium-Redaktion
-- und damit konsistent für YouTube- und TikTok-Fassungen desselben Moments.
alter table shorts_premium_settings
  add column if not exists narration_target_seconds int not null default 28
    check(narration_target_seconds between 15 and 45),
  add column if not exists speak_video_title boolean not null default false;
