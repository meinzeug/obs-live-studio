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

OBS WebSocket stellt nur eine reguläre Streamingausgabe bereit. Der Multistream-Modus verwendet deshalb einen lokalen nginx-RTMP-Relay: OBS encodiert einmal, der Relay dupliziert denselben Datenstrom und übergibt beide Kopien an getrennte stunnel-Verbindungen. Die ausgehenden Verbindungen verwenden RTMPS mit Zertifikats- und Hostnamenprüfung.

Erforderliche lokale Konfiguration:

```dotenv
MULTISTREAM_ENABLED=true
YOUTUBE_ENABLED=true
STREAM_SERVER=rtmps://a.rtmps.youtube.com:443/live2
STREAM_KEY=<youtube-streamschluessel>
TWITCH_ENABLED=true
TWITCH_STREAM_SERVER=rtmps://live.twitch.tv:443/app
TWITCH_STREAM_KEY=<twitch-streamschluessel>
```

Konfiguration und Neustart:

```bash
node --env-file=.env scripts/configure-stream-relay.mjs
node --env-file=.env scripts/configure-obs.mjs
scripts/install-user-services.sh
systemctl --user restart obs-live-studio.target
systemctl --user status obs-live-studio-stream-relay.service
curl http://127.0.0.1:12091/health
```

Sicherheits- und Betriebsregeln:

- `MULTISTREAM_RELAY_SERVER` bleibt auf `rtmp://127.0.0.1:19350/live` oder einer anderen Loopback-Adresse.
- Die Zielserver müssen mit `rtmps://` beginnen. Unverschlüsselte externe RTMP-Ziele werden abgelehnt.
- `var/stream-relay/nginx.conf` enthält Streamschlüssel und bleibt `0600`; das Verzeichnis bleibt `0700`.
- Streamschlüssel dürfen weder in Git noch in Screenshots, Logs oder Supportausgaben erscheinen.
- Vor Aktivierung müssen Encoder-Livestreams auf beiden Plattformkonten freigeschaltet sein.
- Die verfügbare Uploadrate muss für beide Plattformen zusammen zuzüglich Reserve ausreichen.
- Ein produktiver Test beginnt mit einem nicht gelisteten beziehungsweise eingeschränkt sichtbaren Teststream auf beiden Plattformen.

Der direkte YouTube-Modus bleibt vollständig erhalten: Bei `MULTISTREAM_ENABLED=false` konfiguriert `scripts/configure-obs.mjs` weiterhin das bisherige YouTube-Profil ohne lokalen Relay.

## YouTube-Konto wechseln

Dieser Ablauf gilt für den direkten YouTube-Modus. Ein Kanalwechsel setzt die alte OBS-Anmeldung und den alten Streamschlüssel bewusst zurück. OBS muss dabei beendet sein:

```bash
systemctl --user stop obs-live-studio-desktop-agent.service
npm run obs:reset-youtube
systemctl --user start obs-live-studio-desktop-agent.service
```

Danach in OBS unter **Einstellungen > Stream** entweder das neue YouTube-Konto verbinden oder den Streamschlüssel aus YouTube Studio eintragen. Erst nach einem erfolgreichen manuellen Test darf `STREAM_AUTO_START=true` gesetzt und die API neu gestartet werden. Das Reset-Script legt vor jeder Änderung ein lokales Backup unter `var/backups/` an.

Ein anderer Kanal darf nicht verwendet werden, um eine von YouTube verhängte Livestream- oder Kontosperre zu umgehen. Vor der Verbindung muss YouTube Studio den Zielkanal ausdrücklich für Encoder-Livestreams freigeben.
