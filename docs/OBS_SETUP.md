# OBS_SETUP

Diese Dokumentation beschreibt den Stand des lauffähigen Grundsystems und die produktionsrelevanten Regeln.

## Kernpunkte

- Alle Bedienoberflächen sind deutschsprachig geplant und im Grundsystem unter `apps/web` angelegt.
- OBS wird ausschließlich über ein eigenes Profil und eine eigene Szenensammlung genutzt: **Automated News Studio**.
- Direkte OBS-Dateiänderungen dürfen nur bei beendetem OBS und nach Backup erfolgen; im Betrieb wird OBS WebSocket verwendet.
- Quellenabrufe respektieren SSRF-Schutz, robots-/Nutzungsgrenzen und umgehen keine Paywalls, Logins oder Captchas.
- Fremde Artikel werden nicht vollständig neu veröffentlicht; das System erzeugt neutrale Zusammenfassungen mit Quellenhinweis.
- Streamschlüssel und Secrets werden maskiert angezeigt, mit Dateimodus `0600` gespeichert und dürfen nicht geloggt werden.

## Linux-Hinweise

Für OBS-Autostart sind eine aktive X11- oder Wayland-Sitzung, `XDG_RUNTIME_DIR`, Zugriff auf PipeWire/PulseAudio, GPU-Treiber und deaktivierter Ruhezustand erforderlich. Systemweite Dienste besitzen typischerweise keinen Zugriff auf die grafische Sitzung; der Desktop-Agent läuft deshalb als User Service. `OBS_BROWSER_HW_ACCEL=false` ist der stabile Standard für Hosts mit Software-Rendering und kann auf einem geprüften GPU-System gezielt aktiviert werden.

## Parallelausgabe an YouTube und Twitch

Die YouTube-Ausgabe bleibt die reguläre OBS-Hauptausgabe. Twitch wird als zusätzliches Ziel des Plugins **Multiple RTMP Outputs (`sorayuki/obs-multi-rtmp`)** eingerichtet. Das verwaltete Ziel setzt `sync-start` und `sync-stop` auf `true`; dadurch reagiert es auf die OBS-Ereignisse zum Starten und Stoppen der Hauptausgabe. Da weder `video-config` noch `audio-config` gesetzt werden, verwendet das Plugin die Encoder der OBS-Hauptausgabe.

Erforderliche lokale Konfiguration:

```dotenv
STREAM_SERVER=rtmps://a.rtmps.youtube.com:443/live2
STREAM_KEY=<youtube-streamschluessel>
TWITCH_ENABLED=true
TWITCH_STREAM_SERVER=rtmps://live.twitch.tv:443/app
TWITCH_STREAM_KEY=<twitch-streamschluessel>
OBS_MULTI_RTMP_RELEASE=latest
```

Installation, Konfiguration und Neustart:

```bash
npm run obs:install-multi-rtmp
systemctl --user stop obs-live-studio-desktop-agent.service || true
npm run obs:configure
systemctl --user restart obs-live-studio.target
```

Das Installationsskript lädt ausschließlich ein passendes Ubuntu-Archiv aus den offiziellen GitHub-Releases von `sorayuki/obs-multi-rtmp`. Archivpfade und Dateigröße werden geprüft; der SHA-256-Digest des Assets wird zwingend verifiziert. Fehlt er in der GitHub-Antwort, muss er über `OBS_MULTI_RTMP_SHA256` vorgegeben werden.

Sicherheits- und Betriebsregeln:

- Das Twitch-Ziel muss `rtmps://` verwenden. Unverschlüsseltes externes RTMP wird abgelehnt.
- `TWITCH_STREAM_KEY` darf weder in Git noch in Screenshots, Logs oder Supportausgaben erscheinen.
- `obs-multi-rtmp.json` wird mit Dateimodus `0600` geschrieben.
- Nur das Ziel `argumentationskette-twitch` wird automatisiert ersetzt oder entfernt; andere Plugin-Ziele bleiben unverändert.
- Vor Aktivierung müssen Encoder-Livestreams auf beiden Plattformkonten freigeschaltet sein.
- Die verfügbare Uploadrate muss für YouTube und Twitch zusammen zuzüglich Reserve ausreichen.
- Ein produktiver Test beginnt mit eingeschränkt sichtbaren Teststreams auf beiden Plattformen.
- Das Control-Center bewertet den Zustand der OBS-Hauptausgabe. Den detaillierten Zustand des Twitch-Ziels zeigt das Plugin-Dock in OBS.

Bei `TWITCH_ENABLED=false` entfernt `npm run obs:configure` nur das verwaltete Twitch-Ziel und setzt `STREAM_SERVICE` wieder auf `youtube`.

## YouTube-Konto wechseln

Ein Kanalwechsel setzt die alte OBS-Anmeldung und den alten Streamschlüssel bewusst zurück. OBS muss dabei beendet sein:

```bash
systemctl --user stop obs-live-studio-desktop-agent.service
npm run obs:reset-youtube
systemctl --user start obs-live-studio-desktop-agent.service
```

Danach in OBS unter **Einstellungen > Stream** entweder das neue YouTube-Konto verbinden oder den Streamschlüssel aus YouTube Studio eintragen. Erst nach einem erfolgreichen manuellen Test darf `STREAM_AUTO_START=true` gesetzt und die API neu gestartet werden. Das Reset-Script legt vor jeder Änderung ein lokales Backup unter `var/backups/` an.

Ein anderer Kanal darf nicht verwendet werden, um eine von YouTube verhängte Livestream- oder Kontosperre zu umgehen. Vor der Verbindung muss YouTube Studio den Zielkanal ausdrücklich für Encoder-Livestreams freigeben.
