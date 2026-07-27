alter table broadcast_templates
  drop constraint if exists broadcast_templates_content_mode_check;

update broadcast_templates
set content_mode='ai-roundtable',
    flow=jsonb_set(
      coalesce(flow,'{}'::jsonb),
      '{contentMode}',
      '"ai-roundtable"'::jsonb,
      true
    ),
    updated_at=now()
where deleted_at is null
  and coalesce((settings->>'aiRoundtable')::boolean,false)=true;

alter table broadcast_templates
  add constraint broadcast_templates_content_mode_check
  check(content_mode in ('news','youtube','mixed','youtube-news-sidebar','youtube-context','ai-roundtable'));
