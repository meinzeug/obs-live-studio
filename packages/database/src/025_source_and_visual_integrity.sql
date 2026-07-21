create or replace function normalize_source_update_state()
returns trigger
language plpgsql
as $$
begin
  -- Ein leerer User-Agent ist die explizite Löschoperation. NULL darf nicht
  -- wieder mit OLD überschrieben werden, weil partielle Updates den bisherigen
  -- Wert bereits explizit an die Datenbank übergeben.
  if new.user_agent = '' then
    new.user_agent := null;
  end if;

  if new.url is distinct from old.url then
    new.etag := null;
    new.last_modified := null;
    new.last_success_at := null;
    new.last_error := null;
    new.consecutive_errors := 0;
  end if;
  return new;
end;
$$;

create or replace function require_article_video_for_broadcast()
returns trigger
language plpgsql
as $$
begin
  -- YouTube-Elemente tragen bewusst keine article_id; das Video selbst ist
  -- deren Bildquelle und fällt nicht unter die Artikel-Medienprüfung.
  if new.article_id is null then
    return new;
  end if;
  if coalesce((select (value->>'requireVideo')::boolean from system_settings where key='autopilot.config'), true) = false then
    return new;
  end if;
  -- Interne Planungs-, Wiederherstellungs- und Migrationabläufe dürfen einen
  -- Entwurf zunächst vollständig zusammensetzen. Die öffentlichen
  -- Datenbankfunktionen prüfen die Medienbereitschaft bereits beim Hinzufügen;
  -- dieser Trigger bleibt die letzte Schranke für nicht mehr als Entwurf
  -- markierte Sendungen.
  if exists(select 1 from broadcast_playlists bp where bp.id=new.playlist_id and bp.status='draft') then
    return new;
  end if;
  if not exists(
    select 1
    from media_links ml
    join media_assets ma on ma.id=ml.media_id
    where ml.article_id=new.article_id
      and ma.storage_path is not null
      and (
        (ml.purpose='article-video' and ma.mime_type like 'video/%')
        or (ml.purpose='article-graphic' and ma.mime_type like 'image/%')
      )
  ) then
    raise exception 'Kein freigegebenes lokales Video oder Bild/Grafik für Beitrag % vorhanden', new.article_id;
  end if;
  return new;
end;
$$;
