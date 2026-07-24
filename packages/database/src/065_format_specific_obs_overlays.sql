-- Jede aktive Einordnungssendung erhält eine eigene visuelle Identität.
-- Die Projekte bleiben mit dem youtube-context Renderer editierbar, besitzen
-- aber getrennte veröffentlichte Versionen und werden in OBS auf eigene
-- Szenen und Browser-Inputs gelegt.

create or replace function style_context_format_overlay(
  document jsonb,
  format_variant text,
  format_name text,
  format_kicker text,
  accent text,
  accent_soft text,
  panel_background text,
  video_x int,
  video_y int,
  video_width int,
  video_height int,
  corner_radius int
)
returns jsonb language plpgsql as $$
declare
  elements jsonb;
  title_element jsonb;
  source_y int := least(850,video_y+video_height+16);
begin
  if document is null then return document; end if;
  elements := case
    when jsonb_typeof(document->'elements')='array' then document->'elements'
    else '[]'::jsonb
  end;

  elements := (
    select coalesce(jsonb_agg(
      case current_element->>'name'
        when 'AVA Studio Fläche' then current_element || jsonb_build_object(
          'props',coalesce(current_element->'props','{}'::jsonb) || jsonb_build_object(
            'background',panel_background,'borderColor',accent_soft,'borderWidth',3,'borderRadius',corner_radius
          )
        )
        when 'AVA Akzent' then current_element || jsonb_build_object(
          'props',coalesce(current_element->'props','{}'::jsonb) || jsonb_build_object(
            'background',accent,'borderRadius',greatest(2,corner_radius/4)
          )
        )
        when 'Format Label' then current_element || jsonb_build_object(
          'binding','youtubeContext.formatName',
          'props',coalesce(current_element->'props','{}'::jsonb) || jsonb_build_object(
            'text',format_name,'color',accent,'fontSize',24,'fontWeight','950'
          )
        )
        when 'YouTube Feld Schatten' then current_element || jsonb_build_object(
          'x',greatest(0,video_x-12),'y',greatest(0,video_y-12),
          'width',video_width+24,'height',video_height+24,
          'props',coalesce(current_element->'props','{}'::jsonb) || jsonb_build_object(
            'background','rgba(0,0,0,0.72)','borderRadius',corner_radius+6
          )
        )
        when 'YouTube Feld Rahmen' then current_element || jsonb_build_object(
          'x',video_x,'y',video_y,'width',video_width,'height',video_height,
          'props',coalesce(current_element->'props','{}'::jsonb) || jsonb_build_object(
            'borderColor',accent,'borderWidth',4,'borderRadius',corner_radius
          )
        )
        when 'YouTube Quellenfläche' then current_element || jsonb_build_object(
          'x',video_x,'y',source_y,'width',video_width,'height',84,
          'props',coalesce(current_element->'props','{}'::jsonb) || jsonb_build_object(
            'background',panel_background,'borderColor',accent_soft,'borderWidth',2,'borderRadius',corner_radius
          )
        )
        when 'YouTube Kanal' then current_element || jsonb_build_object('x',video_x+26,'y',source_y+12)
        when 'YouTube Titel' then current_element || jsonb_build_object(
          'x',video_x+376,'y',source_y+12,'width',greatest(280,video_width-402)
        )
        when 'YouTube URL' then current_element || jsonb_build_object('x',video_x+26,'y',source_y+48)
        when 'YouTube Upload-Datum' then current_element || jsonb_build_object(
          'x',video_x+video_width-392,'y',source_y+48,'width',366
        )
        when 'Nächste Sendung Fläche' then current_element || jsonb_build_object(
          'x',video_x,'width',video_width,
          'props',coalesce(current_element->'props','{}'::jsonb) || jsonb_build_object(
            'background','rgba(3,7,14,0.94)','borderColor',accent_soft,'borderRadius',corner_radius
          )
        )
        when 'Nächste Sendung Label' then current_element || jsonb_build_object(
          'x',video_x+26,
          'props',coalesce(current_element->'props','{}'::jsonb) || jsonb_build_object('color',accent)
        )
        when 'Nächstes Video Titel' then current_element || jsonb_build_object(
          'x',video_x+222,'width',greatest(300,video_width-440)
        )
        when 'Nächstes Video Meta' then current_element || jsonb_build_object(
          'x',video_x+222,'width',greatest(300,video_width-440)
        )
        when 'Nächster Countdown' then current_element || jsonb_build_object(
          'x',video_x+video_width-220,
          'props',coalesce(current_element->'props','{}'::jsonb) || jsonb_build_object('color',accent)
        )
        when 'Chat CTA Fläche' then current_element || jsonb_build_object(
          'props',coalesce(current_element->'props','{}'::jsonb) || jsonb_build_object(
            'borderColor',accent_soft,'background','rgba(3,7,14,0.96)'
          )
        )
        when 'Chat CTA Hinweis' then current_element || jsonb_build_object(
          'props',coalesce(current_element->'props','{}'::jsonb) || jsonb_build_object(
            'text','Stellt eure Fragen im Chat!','color',accent
          )
        )
        else current_element
      end
      order by ordinal
    ),'[]'::jsonb)
    from jsonb_array_elements(elements) with ordinality entries(current_element,ordinal)
  );

  title_element := jsonb_build_object(
    'id','format-identity-' || format_variant,
    'type','text',
    'name','Sendungsformat Titel',
    'x',video_x,
    'y',greatest(34,video_y-74),
    'width',video_width,
    'height',48,
    'rotation',0,
    'opacity',1,
    'zIndex',12,
    'locked',false,
    'hidden',false,
    'binding','youtubeContext.formatName',
    'props',jsonb_build_object(
      'fontFamily','Inter','fontSize',34,'fontWeight','950','color','#ffffff',
      'background','transparent','borderColor','transparent','borderWidth',0,
      'borderRadius',0,'padding',0,'align','left','objectFit','contain',
      'text',format_name,'animation','slide'
    )
  );
  if not exists(
    select 1 from jsonb_array_elements(elements) element
    where element->>'name'='Sendungsformat Titel'
  ) then
    elements := elements || jsonb_build_array(title_element);
  else
    elements := (
      select jsonb_agg(
        case when element->>'name'='Sendungsformat Titel' then title_element else element end
        order by ordinal
      )
      from jsonb_array_elements(elements) with ordinality entries(element,ordinal)
    );
  end if;

  return jsonb_set(
    document
      || jsonb_build_object(
        'name',format_name || ' Overlay',
        'formatVariant',format_variant,
        'formatIdentity',jsonb_build_object(
          'name',format_name,'kicker',format_kicker,'accent',accent,
          'accentSoft',accent_soft,'panelBackground',panel_background
        )
      ),
    '{elements}',elements,true
  );
end;
$$;

do $$
declare
  design record;
  project_row record;
  source_snapshot jsonb;
  styled_snapshot jsonb;
  next_version int;
begin
  for design in
    select * from (values
      ('ava-context-lagezentrum','lagezentrum','AVA Lagezentrum Live','AKTUELLE LAGE','#00c8ff','rgba(0,200,255,0.58)','rgba(2,12,27,0.94)',44,136,1228,691,18),
      ('ava-context-faktenradar','faktenradar','AVA Faktenradar Live','CLAIM · BELEG · URTEIL','#22c55e','rgba(34,197,94,0.58)','rgba(3,20,14,0.95)',72,124,1188,668,8),
      ('ava-context-streitpunkt','streitpunkt','AVA Streitpunkt Arena','PRO · CONTRA · CHAT','#fb7185','rgba(251,113,133,0.62)','rgba(31,7,17,0.95)',56,168,1148,646,24),
      ('ava-context-quellencheck','quellencheck','AVA Quellenlabor Live','PRIMÄRQUELLE · GEGENCHECK','#f59e0b','rgba(245,158,11,0.62)','rgba(31,18,3,0.95)',76,150,1164,655,6),
      ('ava-context-nachtstudio','nachtstudio','AVA Nachtgespräch Live','DIE LANGE EINORDNUNG','#8b5cf6','rgba(139,92,246,0.62)','rgba(13,8,31,0.96)',104,186,1084,610,30),
      ('zeitkante-tagesueberblick','tagesueberblick','Tagesüberblick','DAS WICHTIGSTE DES TAGES','#38bdf8','rgba(56,189,248,0.62)','rgba(2,20,36,0.95)',38,118,1240,698,14),
      ('publikumslage-mit-mia','publikumslage','Publikumslage mit Mia','DER CHAT BESTIMMT MIT','#34d399','rgba(52,211,153,0.62)','rgba(2,24,19,0.95)',70,142,1168,657,26),
      ('youtube-context','classic','YouTube-Einordnung mit AVA','EINORDNUNGSSTUDIO','#e11d48','rgba(225,29,72,0.58)','rgba(20,7,13,0.95)',58,154,1200,675,18)
    ) as rows(
      system_key,variant,format_name,kicker,accent,accent_soft,panel_background,
      video_x,video_y,video_width,video_height,corner_radius
    )
  loop
    select project.* into project_row
    from broadcast_templates format
    join overlay_projects project on project.id=format.overlay_project_id
    where format.system_key=design.system_key
      and format.active=true
      and format.deleted_at is null
      and project.deleted_at is null
    limit 1;
    if project_row.id is null then continue; end if;

    select version.snapshot into source_snapshot
    from overlay_versions version
    where version.project_id=project_row.id
    order by (version.status='published') desc,version.version desc,version.created_at desc
    limit 1;
    if source_snapshot is null then
      select snapshot into source_snapshot from overlay_templates where name='youtube-context';
    end if;

    styled_snapshot := style_context_format_overlay(
      source_snapshot,design.variant,design.format_name,design.kicker,
      design.accent,design.accent_soft,design.panel_background,
      design.video_x,design.video_y,design.video_width,design.video_height,design.corner_radius
    );
    select coalesce(max(version),0)+1 into next_version
    from overlay_versions where project_id=project_row.id;
    update overlay_versions
    set status='archived',published=false
    where project_id=project_row.id and status='published';
    insert into overlay_versions(project_id,version,snapshot,published,status,label)
    values(project_row.id,next_version,styled_snapshot,true,'published','Individuelles Sendungsdesign');
    update overlay_projects
    set name=design.format_name || ' Overlay',version=greatest(version,next_version),status='published'
    where id=project_row.id;
  end loop;
end;
$$;

drop function style_context_format_overlay(
  jsonb,text,text,text,text,text,text,int,int,int,int,int
);
