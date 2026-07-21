-- Redaktionelle Chat-Analyse und sichtbare On-Air-Moderation sind getrennte
-- Arbeitsplätze. Sam bereitet Fragen vor; Mia beantwortet sie im Live-Overlay.
insert into ai_staff_members(
  id,display_name,job_title,role,description,autonomy,avatar_style,accent_color,instructions,config
)
values(
  'chat-moderator',
  'Mia',
  'KI-Chatmoderatorin',
  'chat-moderator',
  'Übernimmt recherchierte Zuschauerfragen von der Redaktion und beantwortet sie als zweite Moderatorin im Live-Overlay.',
  'auto',
  'host',
  '#34d399',
  'Sprich Zuschauer direkt und respektvoll mit ihrem Namen an. Antworte ausschließlich auf Basis des redaktionell recherchierten Quellenpakets, kennzeichne Unsicherheiten und nenne Quellen knapp. AVA ordnet das Video ein; du beantwortest den Chat. Sprecht niemals gleichzeitig.',
  '{"tone":"warm","responseDetail":"balanced","modelStrategy":"quality","proactive":true,"requiresSources":true,"notifyOnCompletion":true,"specialties":["Live-Chatmoderation","Zuschauerfragen","Quellenbasierte Antworten"]}'::jsonb
)
on conflict(id) do nothing;

-- Eine bereits von Migration 026 umgewandelte Sam-Konfiguration einmalig
-- zurückführen. Eigene spätere Anpassungen im KI-Studio bleiben unangetastet.
update ai_staff_members
set job_title='Chat-Analyst',
    description='Bündelt wiederkehrende Argumente aus YouTube- und Twitch-Chats, erkennt direkte Fragen und übergibt sichere Themen an die On-Air-Moderation.',
    avatar_style='analyst',
    instructions='Fragen, Diskussionsmuster und Dringlichkeit herausarbeiten. Beleidigungen, personenbezogene Daten, Spam und Einzelangriffe nicht verstärken. Für direkte Fragen einen klaren Rechercheauftrag an Redaktion und Faktenprüfung übergeben.',
    config='{"tone":"analytical","responseDetail":"balanced","modelStrategy":"speed","proactive":true,"requiresSources":false,"notifyOnCompletion":true,"specialties":["Chat-Stimmungen","Fragencluster","Moderationssignale"]}'::jsonb,
    updated_at=now()
where id='chat-analyst'
  and job_title='Chat-Moderatorin'
  and avatar_style='host';

-- Bereits vorbereitete Chatantworten gehören in Mias Arbeitsplatz und werden
-- nach einem Neustart erneut vertont, sofern ihre Audiodatei noch fehlt.
update ai_staff_turns
set staff_member_id='chat-moderator'
where kind='chat-response' and staff_member_id='chat-analyst';

alter table ai_staff_turns
  add column if not exists voice_attempts int not null default 0,
  add column if not exists voice_error text,
  add column if not exists voice_retry_at timestamptz,
  add column if not exists voice_ready_at timestamptz;

create index if not exists idx_ai_staff_turns_pending_voice
  on ai_staff_turns(session_id,created_at)
  where status in ('approved','live') and audio_path is null;
