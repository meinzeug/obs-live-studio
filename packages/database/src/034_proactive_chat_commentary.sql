-- Sams Chat-Lagebild und Mias proaktive Kommentare sind von direkten
-- Zuschauerfragen getrennt. Der Fingerabdruck verhindert Wiederholungen auch
-- nach einem Neustart des API-Dienstes.
alter table ai_staff_turns
  add column if not exists chat_fingerprint text;

alter table ai_staff_turns
  drop constraint if exists ai_staff_turn_kind_valid;
alter table ai_staff_turns
  add constraint ai_staff_turn_kind_valid
  check(kind in ('intro','context','question','chat-response','chat-commentary','cta','fallback'));

create index if not exists idx_ai_staff_turns_chat_commentary
  on ai_staff_turns(session_id,created_at desc)
  where kind='chat-commentary';

-- Links stehen die Defaults, rechts die vorhandene Benutzerkonfiguration.
-- Bereits im KI-Studio gesetzte Werte gewinnen daher bei jeder Migration.
update ai_staff_members
set config=jsonb_build_object(
      'chatAnalysisEnabled',true,
      'chatAnalysisIntervalSeconds',180,
      'chatActivityWindowSeconds',360,
      'chatMinimumDistinctMessages',3,
      'chatMinimumUniqueAuthors',2,
      'chatDuplicateSuppressionMinutes',30
    ) || coalesce(config,'{}'::jsonb),
    updated_at=now()
where id='chat-analyst';

update ai_staff_members
set config=jsonb_build_object(
      'proactiveChatCommentary',true,
      'chatCommentaryIntervalSeconds',180,
      'chatCommentaryDurationSeconds',20
    ) || coalesce(config,'{}'::jsonb),
    updated_at=now()
where id='chat-moderator';
