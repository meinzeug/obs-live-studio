# OBS_SETUP

Diese Dokumentation beschreibt den Stand des lauffähigen Grundsystems und die produktionsrelevanten Regeln.

## Kernpunkte

- Alle Bedienoberflächen sind deutschsprachig geplant und im Grundsystem unter `apps/web` angelegt.
- OBS wird ausschließlich über ein eigenes Profil und eine eigene Szenensammlung genutzt: **Automated News Studio**.
- Direkte OBS-Dateiänderungen dürfen nur bei beendetem OBS und nach Backup erfolgen; im Betrieb wird OBS WebSocket verwendet.
- Quellenabrufe respektieren SSRF-Schutz, robots-/Nutzungsgrenzen und umgehen keine Paywalls, Logins oder Captchas.
- Fremde Artikel werden nicht vollständig neu veröffentlicht; das System erzeugt neutrale Zusammenfassungen mit Quellenhinweis.
- Streamschlüssel und Secrets werden niemals an Browser oder API ausgeliefert und dürfen nicht geloggt werden.

## Linux-Hinweise

Für OBS-Autostart sind eine aktive X11- oder Wayland-Sitzung, `XDG_RUNTIME_DIR`, Zugriff auf PipeWire/PulseAudio, GPU-Treiber und deaktivierter Ruhezustand erforderlich. Systemweite Dienste besitzen typischerweise keinen Zugriff auf die grafische Sitzung; der Desktop-Agent läuft deshalb als User Service. `OBS_BROWSER_HW_ACCEL=false` ist der stabile Standard für Hosts mit Software-Rendering und kann auf einem geprüften GPU-System gezielt aktiviert werden.

## Streamingziele

YouTube ist standardmäßig der OBS-Hauptausgang. Twitch kann zusätzlich als paralleler Ausgang aktiviert werden. Beide Ausgänge verwenden denselben OBS-Prozess, dieselben Szenen und denselben Ton.

```env
STREAM_PRIMARY_PROVIDER=youtube

YOUTUBE_STREAM_ENABLED=true
YOUTUBE_STREAM_SERVER=rtmps://a.rtmps.youtube.com:443/live2
YOUTUBE_STREAM_KEY=
YOUTUBE_CHANNEL_NAME=ArgumentationsKette
YOUTUBE_CHANNEL_URL=https://www.youtube.com/@DEIN_KANAL

TWITCH_STREAM_ENABLED=true
TWITCH_STREAM_SERVER=rtmp://live.twitch.tv/app
TWITCH_STREAM_KEY=live_DEIN_TWITCH_SCHLUESSEL
TWITCH_CHANNEL_NAME=ArgumentationsKette
TWITCH_CHANNEL_URL=https://www.twitch.tv/DEIN_KANAL
```

Die alten Variablen `STREAM_SERVICE`, `STREAM_SERVER`, `STREAM_KEY` und `CHANNEL_NAME` werden weiterhin als YouTube-Fallback unterstützt.

## OBS Multi-RTMP installieren

Für einen parallelen Twitch-Ausgang wird das freie OBS-Plugin **obs-multi-rtmp** benötigt. Es muss zur installierten OBS-Hauptversion passen.

Nach der Installation muss eine dieser Dateien vorhanden sein:

- `/usr/lib/obs-plugins/obs-multi-rtmp.so`
- `/usr/lib/x86_64-linux-gnu/obs-plugins/obs-multi-rtmp.so`
- `/usr/local/lib/obs-plugins/obs-multi-rtmp.so`
- `~/.config/obs-studio/plugins/obs-multi-rtmp/bin/64bit/obs-multi-rtmp.so`

Ein abweichender Pfad kann gesetzt werden:

```env
OBS_MULTI_RTMP_PLUGIN_PATH=/pfad/zu/obs-multi-rtmp.so
```

Anschließend OBS beenden und die Konfiguration neu erzeugen:

```bash
systemctl --user stop obs-live-studio-desktop-agent.service
npm run obs:configure
systemctl --user start obs-live-studio-desktop-agent.service
```

`obs:configure` erstellt im OBS-Profil:

- `service.json` für den Hauptausgang
- `obs-multi-rtmp.json` für alle zusätzlichen Ausgänge
- `apps/web/public/stream-targets.json` ohne Streamschlüssel für die Weboberfläche

Der Twitch-Ausgang erhält `sync-start=true` und `sync-stop=true`. Dadurch startet und stoppt er zusammen mit dem normalen OBS-Hauptstream. Bereits vorhandene fremde Multi-RTMP-Ziele werden nicht gelöscht; nur Ziele mit einer ID beginnend mit `ans-` werden von dieser Software verwaltet.

## Bandbreite

Bei gemeinsamer Encoder-Nutzung wird der Videostream für jedes Ziel separat hochgeladen. Bei 6 Mbit/s Video und 160 kbit/s Audio werden für YouTube und Twitch zusammen mindestens rund 12,5 Mbit/s stabiler Upload benötigt. Für Reserven, Protokoll-Overhead und Schwankungen sollte die dauerhaft verfügbare Uploadrate deutlich höher liegen.

Vor dem Aktivieren von `STREAM_AUTO_START=true` muss ein manueller Paralleltest durchgeführt werden. Kontrolliere dabei beide Plattformen unabhängig auf Bild, Ton, Verzögerung und ausgelassene Frames.

## YouTube-Konto wechseln

Ein Kanalwechsel setzt die alte OBS-Anmeldung und den alten Streamschlüssel bewusst zurück. OBS muss dabei beendet sein:

```bash
systemctl --user stop obs-live-studio-desktop-agent.service
npm run obs:reset-youtube
systemctl --user start obs-live-studio-desktop-agent.service
```

Danach in OBS unter **Einstellungen > Stream** entweder das neue YouTube-Konto verbinden oder den Streamschlüssel aus YouTube Studio eintragen. Danach erneut `npm run obs:configure` ausführen, damit die öffentliche Zielübersicht aktualisiert wird. Das Reset-Script legt vor jeder Änderung ein lokales Backup unter `var/backups/` an.

Ein anderer Kanal darf nicht verwendet werden, um eine von YouTube oder Twitch verhängte Livestream- oder Kontosperre zu umgehen. Beide Zielkonten müssen ausdrücklich für Encoder-Livestreams freigeschaltet sein.
