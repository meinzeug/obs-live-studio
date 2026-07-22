alter table youtube_videos
  add column if not exists published_at timestamptz;

-- Die bereits veröffentlichte Einordnungs-Grafik wird anhand stabiler Namen
-- auf das neue Regie-Layout gehoben. Farben und sonstige redaktionelle
-- Anpassungen bleiben dabei erhalten; nur die für Video/Moderation nötige
-- Geometrie und Typografie werden vereinheitlicht.
create or replace function upgrade_youtube_context_video_first_layout(document jsonb)
returns jsonb language plpgsql as $$
declare
  elements jsonb;
  candidate jsonb;
  geometry jsonb := $layout$[
    {"name":"AVA Studio Fläche","x":1286,"y":42,"width":592,"height":996},
    {"name":"AVA Akzent","x":1286,"y":42,"width":14,"height":996},
    {"name":"Format Label","x":1320,"y":70,"width":500,"height":38,"props":{"fontSize":25}},
    {"name":"Sender","x":1320,"y":106,"width":524,"height":48,"props":{"fontSize":36}},
    {"name":"YouTube Feld Schatten","x":44,"y":140,"width":1228,"height":703},
    {"name":"YouTube Feld Rahmen","x":56,"y":152,"width":1204,"height":679},
    {"name":"YouTube Quellenfläche","x":56,"y":850,"width":1204,"height":84},
    {"name":"YouTube Kanal","x":82,"y":862,"width":330,"height":32,"props":{"fontSize":21}},
    {"name":"YouTube Titel","x":432,"y":862,"width":802,"height":32,"props":{"fontSize":20}},
    {"name":"YouTube URL","x":82,"y":898,"width":760,"height":24,"props":{"fontSize":16}},
    {"name":"Nächste Sendung Fläche","x":56,"y":948,"width":1204,"height":84},
    {"name":"Nächste Sendung Label","x":82,"y":961,"width":180,"height":28,"props":{"fontSize":17}},
    {"name":"Nächster Countdown","x":1040,"y":956,"width":194,"height":38,"props":{"fontSize":30,"align":"right"}},
    {"name":"Nächstes Video Titel","x":278,"y":958,"width":738,"height":30,"props":{"fontSize":22}},
    {"name":"Nächstes Video Meta","x":278,"y":993,"width":738,"height":24,"props":{"fontSize":18}},
    {"name":"Chat CTA Fläche","x":1304,"y":944,"width":556,"height":66,"zIndex":40},
    {"name":"Chat CTA Hinweis","x":1322,"y":963,"width":192,"height":30,"zIndex":41,"props":{"fontSize":14}},
    {"name":"YouTube Like Fläche","x":1526,"y":955,"width":76,"height":44,"zIndex":41},
    {"name":"YouTube Like Text","x":1526,"y":967,"width":76,"height":22,"zIndex":42,"props":{"fontSize":14,"align":"center"}},
    {"name":"YouTube Teilen Fläche","x":1610,"y":955,"width":88,"height":44,"zIndex":41},
    {"name":"YouTube Teilen Text","x":1610,"y":967,"width":88,"height":22,"zIndex":42,"props":{"fontSize":14,"align":"center"}},
    {"name":"YouTube Abonnieren Fläche","x":1706,"y":955,"width":142,"height":44,"zIndex":41},
    {"name":"YouTube Abonnieren Text","x":1706,"y":966,"width":142,"height":24,"zIndex":42,"props":{"fontSize":16,"align":"center"}}
  ]$layout$::jsonb;
  upload_date jsonb := $element${
    "id":"youtube-context-upload-date","type":"text","name":"YouTube Upload-Datum",
    "x":868,"y":898,"width":366,"height":24,"rotation":0,"opacity":1,"zIndex":0,"locked":false,"hidden":false,
    "binding":"youtube.publishedDate",
    "props":{"fontFamily":"Inter","fontSize":16,"fontWeight":"800","color":"#94a3b8","background":"transparent","borderColor":"transparent","borderWidth":0,"borderRadius":0,"padding":0,"align":"right","objectFit":"contain","text":"Upload-Datum wird ermittelt","animation":"none"}
  }$element$::jsonb;
begin
  if document is null or coalesce(document->>'template','') <> 'youtube-context' then
    return document;
  end if;
  elements := case
    when jsonb_typeof(document->'elements')='array' then document->'elements'
    else '[]'::jsonb
  end;
  for candidate in select value from jsonb_array_elements(geometry)
  loop
    elements := (
      select coalesce(
        jsonb_agg(
          case
            when current_element->>'name'=candidate->>'name' then
              current_element
              || (candidate - array['name','props'])
              || case
                   when candidate ? 'props' then jsonb_build_object(
                     'props',coalesce(current_element->'props','{}'::jsonb) || (candidate->'props')
                   )
                   else '{}'::jsonb
                 end
            else current_element
          end
          order by ordinal
        ),
        '[]'::jsonb
      )
      from jsonb_array_elements(elements) with ordinality entries(current_element,ordinal)
    );
  end loop;
  if exists(
    select 1 from jsonb_array_elements(elements) current_element
    where current_element->>'name'='YouTube Upload-Datum'
  ) then
    elements := (
      select jsonb_agg(
        case
          when current_element->>'name'='YouTube Upload-Datum' then
            current_element
            || jsonb_build_object(
              'x',868,'y',898,'width',366,'height',24,'binding','youtube.publishedDate',
              'props',coalesce(current_element->'props','{}'::jsonb) || upload_date->'props'
            )
          else current_element
        end
        order by ordinal
      )
      from jsonb_array_elements(elements) with ordinality entries(current_element,ordinal)
    );
  else
    elements := elements || jsonb_build_array(upload_date);
  end if;
  return jsonb_set(document,'{elements}',elements,true);
end;
$$;

update overlay_templates
set snapshot=upgrade_youtube_context_video_first_layout(snapshot)
where (name='youtube-context' or snapshot->>'template'='youtube-context')
  and snapshot is distinct from upgrade_youtube_context_video_first_layout(snapshot);

update overlay_versions version
set snapshot=upgrade_youtube_context_video_first_layout(version.snapshot)
from overlay_projects project
where project.id=version.project_id and project.template='youtube-context'
  and version.snapshot is distinct from upgrade_youtube_context_video_first_layout(version.snapshot);

drop function upgrade_youtube_context_video_first_layout(jsonb);
