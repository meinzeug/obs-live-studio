# Themenbezogene Medienrecherche

Open TV Studio behandelt Text und Sprecher-Audio nicht mehr als vollständigen Beitrag. Jeder Beitrag benötigt vor Freigabe, Sendeliste und OBS-Ausspielung mindestens ein lokal gespeichertes, geprüftes Video. Zusätzlich sucht die Software nach Bildern und erzeugt aus geeigneten Zahlen im Artikel 16:9-Statistikkarten.

## Automatischer Ablauf

1. Nach dem Einlesen eines neuen Artikels wird innerhalb derselben PostgreSQL-Transaktion ein deduplizierter Job `discover-article-media` angelegt.
2. Der Worker bildet aus Titel, Kategorie, Region und zentralen Begriffen einen Suchbegriff.
3. Die aktivierten Anbieter werden über ihre offiziellen APIs durchsucht.
4. Jeder Treffer wird mit Anbieter-ID, Originalseite, Vorschau, Urheber, Lizenz, Lizenzlink, Attribution, Relevanz und Rechtestatus gespeichert.
5. Nur Treffer mit bestätigtem Rechtestatus und einer freigegebenen Download-Adresse können automatisch importiert werden.
6. Remote-Dateien werden erneut pro Redirect geprüft, größenbegrenzt und mit einem Gesamttimeout geladen.
7. FFprobe prüft Videodauer und Mindestauflösung. FFmpeg erzeugt ein Vorschaubild.
8. Der bestbewertete sichere Clip wird als `article-video` verknüpft. Eine Zahlenkarte oder das beste sichere Bild wird optional als `article-graphic` verknüpft.
9. Wird kein Clip gefunden, bleibt der Beitrag unsendbar und im Betriebszentrum erscheint eine deduplizierte Warnung.

## Suchanbieter

### Wikimedia Commons

`MEDIA_COMMONS_ENABLED=true` aktiviert die Suche ohne API-Schlüssel. Commons-Ergebnisse werden nur dann automatisch importiert, wenn die API maschinenlesbare Lizenz- und Downloadangaben liefert, die von der Anwendung als freigegeben erkannt werden.

### Pexels

`PEXELS_API_KEY` aktiviert die offiziellen Pexels-Endpunkte unter `https://api.pexels.com/v1/`. Die gespeicherte Attribution nennt Pexels und den jeweiligen Urheber. Die Pexels-Lizenz bleibt am Medium verlinkt.

### Pixabay

`PIXABAY_API_KEY` aktiviert die Pixabay-Video- und Bildsuche. Downloadhosts bleiben auf die vom Treffer vorgegebenen bekannten CDN-Domains begrenzt.

### YouTube

`YOUTUBE_DATA_API_KEY` aktiviert eine Suche über die offizielle YouTube Data API nach einbettbaren Creative-Commons-Videos. YouTube-Treffer werden ausschließlich als redaktionelle Referenz gespeichert. Open TV Studio lädt keine YouTube-Videos herunter und umgeht keine Plattform- oder Rechtebeschränkungen.

## Redaktionelle Freigabe

Die Beitragsansicht zeigt:

- Video-, Bild-, Grafik-, Statistik- und Referenztreffer,
- Anbieter, Urheber, Lizenz, Lizenzlink und Attribution,
- Dauer, Relevanz, Importstatus und Rechtestatus,
- Originalseite und Vorschau,
- erzeugte lokale Vorschaubilder,
- den aktuellen Bereitschaftsstatus des Beitrags.

Ein Treffer mit ungeklärten Rechten kann nur nach einer ausdrücklichen manuellen Bestätigung importiert werden. Eine Ablehnung entfernt auch eine eventuell aktive Medienverknüpfung. Ein zuvor bestätigter Rechtestatus wird durch einen späteren automatischen Suchlauf nicht zurückgesetzt.

## Eigenes Video

Falls die Suche keinen geeigneten Clip findet, kann in der Beitragsansicht ein eigenes MP4-, WebM- oder MOV-Video hochgeladen werden. Vor der Dateiauswahl müssen Urheber, Quelle, Lizenz beziehungsweise Rechtsgrundlage und eine ausdrückliche Rechtebestätigung angegeben werden.

Der Upload wird nicht allein anhand von Dateiname oder Browser-MIME akzeptiert. FFprobe muss einen Videostream, eine positive Laufzeit und mindestens 640 × 360 Pixel erkennen. Dateigröße und Höchstdauer gelten ebenso wie bei Internetmedien.

## OBS-Ausspielung

OBS verwendet pro Beitrag:

- `ANS_ARTICLE_VIDEO` als stummgeschaltete, wiederholte Videoquelle im Hintergrund,
- `ANS_SPRECHER_AUDIO` als führende Ton- und Zeitquelle,
- `ANS_MAIN_OVERLAY` für Headline, Zusammenfassung, Quelle und Ticker,
- optional `ANS_ARTICLE_GRAPHIC` als Bild-in-Bild für Statistik oder Grafik.

Die Hauptvorlage besitzt einen teiltransparenten Hintergrund, damit das bewegte Video sichtbar bleibt. Bei Pause, Fortsetzen, Überspringen oder Stopp wird die Videoquelle gemeinsam mit dem Sprecher gesteuert. Nach dem Beitrag werden Video und Grafik zuverlässig deaktiviert.

## Konfiguration

```dotenv
MEDIA_COMMONS_ENABLED=true
PEXELS_API_KEY=
PIXABAY_API_KEY=
YOUTUBE_DATA_API_KEY=
MEDIA_AUTO_IMPORT_VIDEO=true
MEDIA_AUTO_IMPORT_GRAPHIC=true
MEDIA_DISCOVERY_MAX_CANDIDATES=30
MEDIA_DOWNLOAD_TIMEOUT_MS=120000
MEDIA_MAX_VIDEO_BYTES=262144000
MEDIA_MAX_IMAGE_BYTES=15728640
MEDIA_MAX_VIDEO_DURATION_SECONDS=180
MEDIA_DIRECTORY=./var/media
MEDIA_UPLOAD_DIR=./var/media
FFMPEG_EXECUTABLE=ffmpeg
FFPROBE_EXECUTABLE=ffprobe
```

API-Schlüssel und andere Geheimnisse gehören ausschließlich in die lokale `.env`. Sie werden nicht in Kandidaten, Logs, Statusantworten oder die Browseroberfläche übernommen.

## Harte Sendesperren

Die Pflicht gilt auf mehreren Ebenen:

- Die redaktionelle API verweigert die Freigabe ohne lokales Video.
- PostgreSQL verweigert das Einfügen eines Beitrags in eine Sendeliste ohne `article-video`-Verknüpfung.
- Der Autopilot wartet auf die Medienrecherche und legt ohne Video keine Sendeliste an.
- Der OBS-Resolver verweigert Test- und Produktionsausspielung, falls der Videopfad fehlt.

Damit kann eine Umgehung einer einzelnen Oberfläche nicht wieder zu reinen Text-/Standbildbeiträgen führen.
