-- Bestehende und neue AVA-Einordnungs-Overlays erhalten dieselbe kompakte
-- Publikums-CTA. Die Ergänzung erfolgt anhand stabiler Elementnamen und bleibt
-- deshalb auch bei wiederholten Migrationen sowie bei angepassten Layouts
-- idempotent.
create or replace function ensure_youtube_context_interaction_banner(document jsonb)
returns jsonb language plpgsql as $$
declare
  elements jsonb;
  candidate jsonb;
  legacy_y text;
  defaults jsonb := $elements$[
    {
      "id":"youtube-context-chat-cta-bg","type":"shape","name":"Chat CTA Fläche",
      "x":1136,"y":944,"width":704,"height":66,"rotation":0,"opacity":1,"zIndex":40,"locked":false,"hidden":false,
      "props":{"fontFamily":"Inter","fontSize":42,"fontWeight":"700","color":"#ffffff","background":"rgba(5,8,14,0.94)","borderColor":"rgba(34,211,238,0.58)","borderWidth":2,"borderRadius":20,"padding":0,"align":"left","objectFit":"contain","animation":"none"}
    },
    {
      "id":"youtube-context-chat-cta-copy","type":"text","name":"Chat CTA Hinweis",
      "x":1154,"y":963,"width":264,"height":30,"rotation":0,"opacity":1,"zIndex":41,"locked":false,"hidden":false,
      "props":{"fontFamily":"Inter","fontSize":18,"fontWeight":"900","color":"#a5f3fc","background":"transparent","borderColor":"transparent","borderWidth":0,"borderRadius":0,"padding":0,"align":"left","objectFit":"contain","text":"Stellt eure Fragen im Chat!","animation":"none"}
    },
    {
      "id":"youtube-context-like-bg","type":"shape","name":"YouTube Like Fläche",
      "x":1430,"y":955,"width":96,"height":44,"rotation":0,"opacity":1,"zIndex":41,"locked":false,"hidden":false,
      "props":{"fontFamily":"Inter","fontSize":42,"fontWeight":"700","color":"#ffffff","background":"rgba(31,41,55,0.96)","borderColor":"rgba(255,255,255,0.18)","borderWidth":1,"borderRadius":22,"padding":0,"align":"left","objectFit":"contain","animation":"none"}
    },
    {
      "id":"youtube-context-like-copy","type":"text","name":"YouTube Like Text",
      "x":1430,"y":967,"width":96,"height":22,"rotation":0,"opacity":1,"zIndex":42,"locked":false,"hidden":false,
      "props":{"fontFamily":"Inter","fontSize":14,"fontWeight":"900","color":"#ffffff","background":"transparent","borderColor":"transparent","borderWidth":0,"borderRadius":0,"padding":0,"align":"center","objectFit":"contain","text":"👍 LIKEN","animation":"none"}
    },
    {
      "id":"youtube-context-share-bg","type":"shape","name":"YouTube Teilen Fläche",
      "x":1536,"y":955,"width":108,"height":44,"rotation":0,"opacity":1,"zIndex":41,"locked":false,"hidden":false,
      "props":{"fontFamily":"Inter","fontSize":42,"fontWeight":"700","color":"#ffffff","background":"rgba(31,41,55,0.96)","borderColor":"rgba(255,255,255,0.18)","borderWidth":1,"borderRadius":22,"padding":0,"align":"left","objectFit":"contain","animation":"none"}
    },
    {
      "id":"youtube-context-share-copy","type":"text","name":"YouTube Teilen Text",
      "x":1536,"y":967,"width":108,"height":22,"rotation":0,"opacity":1,"zIndex":42,"locked":false,"hidden":false,
      "props":{"fontFamily":"Inter","fontSize":14,"fontWeight":"900","color":"#ffffff","background":"transparent","borderColor":"transparent","borderWidth":0,"borderRadius":0,"padding":0,"align":"center","objectFit":"contain","text":"↗ TEILEN","animation":"none"}
    },
    {
      "id":"youtube-context-subscribe-bg","type":"shape","name":"YouTube Abonnieren Fläche",
      "x":1654,"y":955,"width":174,"height":44,"rotation":0,"opacity":1,"zIndex":41,"locked":false,"hidden":false,
      "props":{"fontFamily":"Inter","fontSize":42,"fontWeight":"700","color":"#ffffff","background":"#ff0033","borderColor":"transparent","borderWidth":0,"borderRadius":22,"padding":0,"align":"left","objectFit":"contain","animation":"none"}
    },
    {
      "id":"youtube-context-subscribe-copy","type":"text","name":"YouTube Abonnieren Text",
      "x":1654,"y":966,"width":174,"height":24,"rotation":0,"opacity":1,"zIndex":42,"locked":false,"hidden":false,
      "props":{"fontFamily":"Inter","fontSize":16,"fontWeight":"900","color":"#ffffff","background":"transparent","borderColor":"transparent","borderWidth":0,"borderRadius":0,"padding":0,"align":"center","objectFit":"contain","text":"ABONNIEREN","animation":"none"}
    }
  ]$elements$::jsonb;
begin
  if document is null or coalesce(document->>'template','') <> 'youtube-context' then
    return document;
  end if;
  elements := case
    when jsonb_typeof(document->'elements')='array' then document->'elements'
    else '[]'::jsonb
  end;
  for candidate in select value from jsonb_array_elements(defaults)
  loop
    legacy_y := case candidate->>'name'
      when 'Chat CTA Fläche' then '82'
      when 'Chat CTA Hinweis' then '101'
      when 'YouTube Like Fläche' then '93'
      when 'YouTube Like Text' then '105'
      when 'YouTube Teilen Fläche' then '93'
      when 'YouTube Teilen Text' then '105'
      when 'YouTube Abonnieren Fläche' then '93'
      when 'YouTube Abonnieren Text' then '104'
      else null
    end;
    if exists(
      select 1 from jsonb_array_elements(elements) current_element
      where current_element->>'name'=candidate->>'name'
    ) then
      elements := (
        select coalesce(
          jsonb_agg(
            case
              when current_element->>'name'=candidate->>'name'
                and current_element->>'y'=legacy_y then candidate
              else current_element
            end
            order by ordinal
          ),
          '[]'::jsonb
        )
        from jsonb_array_elements(elements) with ordinality entries(current_element,ordinal)
      );
    else
      elements := elements || jsonb_build_array(candidate);
    end if;
  end loop;
  return jsonb_set(document,'{elements}',elements,true);
end;
$$;

update overlay_templates
set snapshot=ensure_youtube_context_interaction_banner(snapshot)
where (name='youtube-context' or snapshot->>'template'='youtube-context')
  and snapshot is distinct from ensure_youtube_context_interaction_banner(snapshot);

update overlay_versions version
set snapshot=ensure_youtube_context_interaction_banner(version.snapshot)
from overlay_projects project
where project.id=version.project_id and project.template='youtube-context'
  and version.snapshot is distinct from ensure_youtube_context_interaction_banner(version.snapshot);

drop function ensure_youtube_context_interaction_banner(jsonb);
