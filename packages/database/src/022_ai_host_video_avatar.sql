create sequence if not exists ai_staff_avatar_sequence_seq;

alter table ai_staff_turns
  add column if not exists avatar_sequence bigint not null default nextval('ai_staff_avatar_sequence_seq');

update ai_staff_members
set avatar_style='video',
    updated_at=now()
where id='moderator'
  and avatar_style is distinct from 'video';
