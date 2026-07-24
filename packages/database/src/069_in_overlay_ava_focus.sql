-- AVA bleibt bei jeder Einordnung im individuellen Sendungsdesign.
-- Die Vollbildübernahme wird durch eine transparente Analyseanimation über
-- dem pausierten YouTube-Bild ersetzt. Die Metadaten werden auch in
-- archivierten Versionen gepflegt, damit erneut veröffentlichte Entwürfe
-- nicht zum alten Verhalten zurückfallen.

create or replace function configure_in_overlay_ava_focus(document jsonb)
returns jsonb language sql immutable as $$
  select case
    when document is null then document
    else document || jsonb_build_object(
      'avaPresentation',
      coalesce(document->'avaPresentation','{}'::jsonb) || jsonb_build_object(
        'mode','in-overlay',
        'showSpokenText',true,
        'pauseVideo',true,
        'pauseEffect','analysis-scan',
        'videoFrameElementName','YouTube Feld Rahmen'
      )
    )
  end
$$;

update overlay_templates
set snapshot=configure_in_overlay_ava_focus(snapshot)
where (name='youtube-context' or snapshot->>'template'='youtube-context')
  and snapshot is distinct from configure_in_overlay_ava_focus(snapshot);

update overlay_versions version
set snapshot=configure_in_overlay_ava_focus(version.snapshot)
from overlay_projects project
where project.id=version.project_id
  and (
    project.template='youtube-context'
    or version.snapshot->>'template'='youtube-context'
  )
  and version.snapshot is distinct from configure_in_overlay_ava_focus(version.snapshot);

update broadcast_items
set rules=coalesce(rules,'{}'::jsonb) || jsonb_build_object('pauseDuringAva',true)
where rules->>'kind'='youtube-context'
  and coalesce((rules->>'pauseDuringAva')::boolean,false)=false;

drop function configure_in_overlay_ava_focus(jsonb);
