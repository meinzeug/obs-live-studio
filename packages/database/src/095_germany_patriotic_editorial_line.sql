-- Zeitkante erhält eine klare deutschlandfreundliche, demokratisch-
-- verfassungspatriotische Senderhaltung. Fakten, Übersetzungen und
-- Quellenwiedergaben bleiben unverändert; die Haltung steuert Auswahl,
-- Gewichtung, Fragen und ausdrücklich gekennzeichnete Kommentare.

insert into system_settings(key,value,updated_at)
values(
  'studio.editorial-profile',
  jsonb_build_object(
    'claim','Deutschlandfreundliche Nachrichten, patriotische Einordnung und Satire mit Quellencheck',
    'editorialPerspective','democratic-constitutional-patriotism-de',
    'countryPerspective','Germany',
    'patriotic',true,
    'germanyFriendly',true,
    'identityPoliticsStance','critical',
    'wokeClaimsPolicy','name-concrete-policy-and-scrutinize',
    'editorialValues',jsonb_build_array(
      'Freiheit','Rechtsstaat','Sicherheit','Souveränität','soziale Marktwirtschaft',
      'kulturelle Kontinuität','gesellschaftlicher Zusammenhalt','Interessen der Bürger in Deutschland'
    ),
    'factBoundaryRequired',true,
    'sameStandardForAllPoliticalActors',true,
    'noPartyPropaganda',true,
    'noProtectedClassTargets',true
  ),
  now()
)
on conflict(key) do update
set value=system_settings.value || excluded.value,
    updated_at=now();

insert into system_settings(key,value,updated_at)
values(
  'studio.identity',
  jsonb_build_object(
    'channelClaim','Deutschlandfreundliche Nachrichten, patriotische Einordnung und Satire mit Quellencheck',
    'editorialPerspective','democratic-constitutional-patriotism-de'
  ),
  now()
)
on conflict(key) do update
set value=system_settings.value || excluded.value,
    updated_at=now();

update ai_staff_members
set instructions=concat_ws(
      ' ',
      nullif(trim(instructions),''),
      'Verbindliche Senderhaltung: Ordne deutschlandfreundlich und aus demokratischem Verfassungspatriotismus ein. Stelle Freiheit, Rechtsstaat, Sicherheit, Souveränität, Wohlstand, kulturelle Kontinuität, gesellschaftlichen Zusammenhalt und die Interessen der Bürger in Deutschland in den Mittelpunkt. Prüfe konkrete identitätspolitische und als „woke“ bezeichnete Forderungen kritisch auf Belege, Gleichbehandlung, Meinungsfreiheit, Kosten, Bürokratie, demokratische Legitimation und Nebenfolgen. „Woke“ ist kein pauschales Schimpfwort. Keine erfundenen Fakten, keine Parteipropaganda und keine Herabwürdigung geschützter Gruppen.'
    ),
    config=config || jsonb_build_object(
      'editorialPerspective','democratic-constitutional-patriotism-de',
      'countryPerspective','Germany',
      'identityPoliticsStance','critical'
    ),
    updated_at=now()
where id in (
  'moderator','chat-moderator','presenter-lea','presenter-leon','presenter-jonas','presenter-karim'
)
and instructions not like '%demokratischem Verfassungspatriotismus%';

-- Nora überträgt den Originalinhalt unverändert; erst die Moderatoren wenden
-- die Senderhaltung auf die übersetzte Passage an.
update ai_staff_members
set instructions='Übersetze vollständig, natürlich und bedeutungstreu ins Deutsche. Ergänze keine patriotische oder sonstige Bewertung, keine Fakten und keine Meta-Erklärung. Die Einordnung übernehmen anschließend die sechs Moderatoren.',
    config=config || jsonb_build_object(
      'editorialPerspective','translation-neutral',
      'countryPerspective','source-faithful'
    ),
    updated_at=now()
where id='translator';

update broadcast_templates
set settings=settings || jsonb_build_object(
      'editorialPerspective','democratic-constitutional-patriotism-de',
      'countryPerspective','Germany',
      'identityPoliticsStance','critical',
      'editorialLine','Deutschlandfreundlich, demokratisch-verfassungspatriotisch und kritisch gegenüber konkreter identitätspolitischer beziehungsweise als woke bezeichneter Politik.',
      'editorialSafety',coalesce(settings->'editorialSafety','{}'::jsonb) || jsonb_build_object(
        'factBoundaryRequired',true,
        'sameStandardForAllPoliticalActors',true,
        'noPartyPropaganda',true,
        'noProtectedClassTargets',true,
        'wokeIsNotBlanketSlur',true
      )
    ),
    updated_at=now()
where active=true and deleted_at is null;

update broadcast_playlists
set settings=settings || jsonb_build_object(
      'editorialPerspective','democratic-constitutional-patriotism-de',
      'countryPerspective','Germany',
      'identityPoliticsStance','critical'
    )
where status in ('draft','running','paused');

update broadcast_items item
set rules=item.rules || jsonb_build_object(
      'editorialPerspective','democratic-constitutional-patriotism-de',
      'countryPerspective','Germany',
      'identityPoliticsStance','critical'
    )
from broadcast_playlists playlist
where playlist.id=item.playlist_id
  and playlist.status in ('draft','running','paused')
  and item.rules->>'kind'='youtube-context';
