# YouTube Video Studio

Der Arbeitsbereich **Shorts & Clips → YouTube Video** ist ein lokaler, nicht-destruktiver Video-Editor. Eine
YouTube-URL wird zunächst mit `yt-dlp` heruntergeladen. Video und Audio werden dabei in der gewählten Qualitätsstufe
bezogen und von FFmpeg zu einer lokalen MP4 zusammengeführt. Erst eine fertige lokale Quelle kann der Timeline
hinzugefügt werden.

Es dürfen nur Inhalte heruntergeladen und bearbeitet werden, für die der Betreiber die erforderlichen Rechte besitzt.
Alters-, Anmelde- und Regionssperren werden nicht umgangen.

## Ablauf

1. Projekt anlegen und **Quellen** öffnen.
2. Eine oder mehrere YouTube-URLs einfügen, Video/Audio und Qualität wählen.
3. Download-Fortschritt im Quellenbrowser beobachten. Aufträge überleben Worker-Neustarts und können nach einem Fehler
   erneut gestartet werden.
4. Fertige Quellen mit `+` in die Video- oder Audiospur übernehmen. Bilder kommen aus Upload oder Mediathek in die
   Grafikspur.
5. Mit Auswahl, Rasierklinge, Ripple-Trim, Rollschnitt, Slip, Snapping und den Trim-Griffen schneiden. `V`, `C`, `B`,
   `R`, `Y`, `N` und `S` aktivieren die wichtigsten Werkzeuge; Pfeiltasten bewegen framegenau, Umschalt+Pfeil um eine
   Sekunde.
6. Text-/Bild-Overlays in der Vorschau ziehen und skalieren, Effekte, Bewegung, Lautstärke und Übergänge im Inspector
   einstellen.
7. Lokal in 720p, 1080p oder 1440p rendern und die fertige MP4 öffnen oder herunterladen.

## API

`POST /api/download` ist der geschützte Kompatibilitätsendpunkt für einen einzelnen Import:

```json
{
  "url": "https://www.youtube.com/watch?v=…",
  "projectId": "optional-project-uuid",
  "quality": "1080p",
  "audioOnly": false
}
```

Ohne `projectId` wird ein Projekt angelegt. Die Antwort liefert `statusUrl`; `GET /api/download/:sourceId` enthält
Status, Fortschritt, geprüfte Metadaten und nach Abschluss den geschützten lokalen Dateipfad als API-URL. Absolute
Serverpfade werden nicht an den Browser übertragen.

Projektimporte nutzen `POST /api/youtube-video-editor/projects/:id/sources/youtube`. Ein fehlgeschlagener oder bewusst
gelöschter Download kann über `POST /api/youtube-video-editor/sources/:id/download` neu eingeplant werden. Nur die
lokale Originaldatei wird mit `DELETE /api/youtube-video-editor/sources/:id/local-file` entfernt; der Quellenverweis
bleibt erhalten.

## Dateisystem und Grenzen

- YouTube-Originale: `downloads/youtube-video-editor/<project-id>/`
- Eigene Uploads: `var/media/video-editor/uploads/`
- Exporte und Vorschaubilder: `var/media/video-editor/renders/<project-id>/`
- Dateinamen werden auf sichere Zeichen begrenzt und enthalten zusätzlich die YouTube-Video-ID.
- Playlists werden nie implizit geladen.
- Standardlimit pro Original: 4 GiB; konfigurierbar mit `VIDEO_EDITOR_MAX_DOWNLOAD_BYTES` (10 MiB bis 20 GiB).
- Projektlänge: höchstens sechs Stunden.

Die Worker-Aufträge sind in PostgreSQL gespeichert. Hängende Downloads werden nach einem Neustart wieder in die
Warteschlange gestellt. Nach drei Fehlern bleibt die Quelle mit einer verständlichen Meldung stehen; zugleich erscheint
eine Meldung im Störungscenter.

## Betrieb

Erforderlich sind `ffmpeg`, `ffprobe` und die bestehende Studio-Installation von `yt-dlp`. Optional kann ein eigenes,
freigegebenes Browserprofil über `YTDLP_COOKIES_FROM_BROWSER` verwendet werden. Das ist ausschließlich für Inhalte
gedacht, auf die der Betreiber bereits rechtmäßig Zugriff besitzt.

CPU-Last und Geschwindigkeit lassen sich mit `VIDEO_EDITOR_PREPARE_PRESET` und `VIDEO_EDITOR_RENDER_PRESET` steuern.
Schnellere Presets erzeugen größere Dateien; langsamere Presets benötigen deutlich mehr CPU-Zeit.
