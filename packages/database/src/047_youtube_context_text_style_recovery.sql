-- Migration 046 lief auf einzelnen Installationen bereits mit einer
-- mehrdeutigen JSONB-Operatorbindung. Dort blieben bei verschobenen
-- Textelementen nur Schriftgröße/Ausrichtung übrig. Repariert werden
-- ausschließlich erkennbar unvollständige Props; bewusst angepasste Stile
-- mit Farbe und Schriftfamilie bleiben unangetastet.
create or replace function recover_youtube_context_text_styles(document jsonb)
returns jsonb language plpgsql as $$
declare
  elements jsonb;
  candidate jsonb;
  styles jsonb := $styles$[
    {"name":"Format Label","props":{"text":"YOUTUBE · EINORDNUNG","fontFamily":"Inter","fontSize":25,"fontWeight":"900","color":"#67e8f9","background":"transparent","borderColor":"transparent","borderWidth":0,"borderRadius":0,"padding":0,"align":"left","objectFit":"contain","animation":"none"}},
    {"name":"Sender","props":{"text":"Zeitkante","fontFamily":"Inter","fontSize":36,"fontWeight":"900","color":"#ffffff","background":"transparent","borderColor":"transparent","borderWidth":0,"borderRadius":0,"padding":0,"align":"left","objectFit":"contain","animation":"none"}},
    {"name":"YouTube Kanal","props":{"text":"Kanal @ YouTube","fontFamily":"Inter","fontSize":21,"fontWeight":"900","color":"#ffffff","background":"transparent","borderColor":"transparent","borderWidth":0,"borderRadius":0,"padding":0,"align":"left","objectFit":"contain","animation":"none"}},
    {"name":"YouTube Titel","props":{"text":"YouTube Video","fontFamily":"Inter","fontSize":20,"fontWeight":"800","color":"#a5f3fc","background":"transparent","borderColor":"transparent","borderWidth":0,"borderRadius":0,"padding":0,"align":"left","objectFit":"contain","animation":"none"}},
    {"name":"YouTube URL","props":{"text":"youtube.com","fontFamily":"Inter","fontSize":16,"fontWeight":"700","color":"#cbd5e1","background":"transparent","borderColor":"transparent","borderWidth":0,"borderRadius":0,"padding":0,"align":"left","objectFit":"contain","animation":"none"}},
    {"name":"Nächste Sendung Label","props":{"text":"ALS NÄCHSTES","fontFamily":"Inter","fontSize":17,"fontWeight":"900","color":"#67e8f9","background":"transparent","borderColor":"transparent","borderWidth":0,"borderRadius":0,"padding":0,"align":"left","objectFit":"contain","animation":"none"}},
    {"name":"Nächster Countdown","props":{"text":"--:--","fontFamily":"Inter","fontSize":30,"fontWeight":"900","color":"#ffffff","background":"transparent","borderColor":"transparent","borderWidth":0,"borderRadius":0,"padding":0,"align":"right","objectFit":"contain","animation":"none"}},
    {"name":"Nächstes Video Titel","props":{"text":"Nächstes YouTube-Video","fontFamily":"Inter","fontSize":22,"fontWeight":"900","color":"#ffffff","background":"transparent","borderColor":"transparent","borderWidth":0,"borderRadius":0,"padding":0,"align":"left","objectFit":"contain","animation":"none"}},
    {"name":"Nächstes Video Meta","props":{"text":"Startzeit wird geladen","fontFamily":"Inter","fontSize":18,"fontWeight":"800","color":"#cbd5e1","background":"transparent","borderColor":"transparent","borderWidth":0,"borderRadius":0,"padding":0,"align":"left","objectFit":"contain","animation":"none"}},
    {"name":"Chat CTA Hinweis","props":{"text":"Stellt eure Fragen im Chat!","fontFamily":"Inter","fontSize":14,"fontWeight":"900","color":"#a5f3fc","background":"transparent","borderColor":"transparent","borderWidth":0,"borderRadius":0,"padding":0,"align":"left","objectFit":"contain","animation":"none"}},
    {"name":"YouTube Like Text","props":{"text":"👍 LIKEN","fontFamily":"Inter","fontSize":14,"fontWeight":"900","color":"#ffffff","background":"transparent","borderColor":"transparent","borderWidth":0,"borderRadius":0,"padding":0,"align":"center","objectFit":"contain","animation":"none"}},
    {"name":"YouTube Teilen Text","props":{"text":"↗ TEILEN","fontFamily":"Inter","fontSize":14,"fontWeight":"900","color":"#ffffff","background":"transparent","borderColor":"transparent","borderWidth":0,"borderRadius":0,"padding":0,"align":"center","objectFit":"contain","animation":"none"}},
    {"name":"YouTube Abonnieren Text","props":{"text":"ABONNIEREN","fontFamily":"Inter","fontSize":16,"fontWeight":"900","color":"#ffffff","background":"transparent","borderColor":"transparent","borderWidth":0,"borderRadius":0,"padding":0,"align":"center","objectFit":"contain","animation":"none"}}
  ]$styles$::jsonb;
begin
  if document is null or coalesce(document->>'template','') <> 'youtube-context' then
    return document;
  end if;
  elements := case
    when jsonb_typeof(document->'elements')='array' then document->'elements'
    else '[]'::jsonb
  end;
  for candidate in select value from jsonb_array_elements(styles)
  loop
    elements := (
      select coalesce(
        jsonb_agg(
          case
            when current_element->>'name'=candidate->>'name'
              and (
                not coalesce(current_element->'props','{}'::jsonb) ? 'color'
                or not coalesce(current_element->'props','{}'::jsonb) ? 'fontFamily'
                or (
                  candidate->>'name'='Chat CTA Hinweis'
                  and current_element->'props'->>'text'='Stellt eure Fragen im Chat!'
                  and coalesce((current_element->'props'->>'fontSize')::int,18)>14
                )
              )
              then current_element || jsonb_build_object('props',candidate->'props')
            else current_element
          end
          order by ordinal
        ),
        '[]'::jsonb
      )
      from jsonb_array_elements(elements) with ordinality entries(current_element,ordinal)
    );
  end loop;
  return jsonb_set(document,'{elements}',elements,true);
end;
$$;

update overlay_templates
set snapshot=recover_youtube_context_text_styles(snapshot)
where (name='youtube-context' or snapshot->>'template'='youtube-context')
  and snapshot is distinct from recover_youtube_context_text_styles(snapshot);

update overlay_versions version
set snapshot=recover_youtube_context_text_styles(version.snapshot)
from overlay_projects project
where project.id=version.project_id and project.template='youtube-context'
  and version.snapshot is distinct from recover_youtube_context_text_styles(version.snapshot);

drop function recover_youtube_context_text_styles(jsonb);
