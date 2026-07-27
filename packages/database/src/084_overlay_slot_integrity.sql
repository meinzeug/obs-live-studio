-- Frühere Wiederholungsläufe der Migrationen 061 und 065 konnten die fünf
-- AVA-Systemoverlays erneut erzeugen, nachdem 065 deren Anzeigenamen geändert
-- hatte. Die aktuell an das jeweilige Sendeformat gebundene Variante bleibt
-- erhalten; automatisch erzeugte Namensduplikate werden nur soft archiviert.
do $$
declare
  format_overlay record;
begin
  for format_overlay in
    select format.system_key,
           format.overlay_project_id keeper_id,
           project.name keeper_name
    from broadcast_templates format
    join overlay_projects project on project.id=format.overlay_project_id
    where format.system_key in (
      'ava-context-lagezentrum',
      'ava-context-faktenradar',
      'ava-context-streitpunkt',
      'ava-context-quellencheck',
      'ava-context-nachtstudio'
    )
      and format.deleted_at is null
      and project.deleted_at is null
  loop
    update broadcast_playlists playlist
    set overlay_project_id=format_overlay.keeper_id
    where playlist.overlay_project_id in (
      select duplicate.id
      from overlay_projects duplicate
      where duplicate.deleted_at is null
        and duplicate.template='youtube-context'
        and lower(duplicate.name)=lower(format_overlay.keeper_name)
        and duplicate.id<>format_overlay.keeper_id
    );

    update broadcast_templates format
    set overlay_project_id=format_overlay.keeper_id,
        updated_at=now()
    where format.overlay_project_id in (
      select duplicate.id
      from overlay_projects duplicate
      where duplicate.deleted_at is null
        and duplicate.template='youtube-context'
        and lower(duplicate.name)=lower(format_overlay.keeper_name)
        and duplicate.id<>format_overlay.keeper_id
    );

    delete from obs_overlay_sources source
    where source.project_id in (
      select duplicate.id
      from overlay_projects duplicate
      where duplicate.deleted_at is null
        and duplicate.template='youtube-context'
        and lower(duplicate.name)=lower(format_overlay.keeper_name)
        and duplicate.id<>format_overlay.keeper_id
    );

    update overlay_versions version
    set status='archived',published=false
    where version.project_id in (
      select duplicate.id
      from overlay_projects duplicate
      where duplicate.deleted_at is null
        and duplicate.template='youtube-context'
        and lower(duplicate.name)=lower(format_overlay.keeper_name)
        and duplicate.id<>format_overlay.keeper_id
    );

    update overlay_projects duplicate
    set deleted_at=now(),
        status='archived',
        obs_scene_name=null,
        obs_input_name=null,
        obs_configured_url=null,
        obs_configured_version_id=null,
        obs_width=null,
        obs_height=null,
        obs_configured_at=null
    where duplicate.deleted_at is null
      and duplicate.template='youtube-context'
      and lower(duplicate.name)=lower(format_overlay.keeper_name)
      and duplicate.id<>format_overlay.keeper_id;
  end loop;
end;
$$;
