# OBS_SETUP

Diese Dokumentation beschreibt die produktionsrelevante OBS-Konfiguration des kanalneutralen **Open TV Studio**.

## Grundregeln

- Kanalname und Studiobezeichnung werden ausschließlich lokal über `CHANNEL_NAME` und `STUDIO_NAME` festgelegt.
- Das OBS-Hauptziel kann YouTube, Twitch, TikTok LIVE, X, Rumble, Kick, Facebook Live, LinkedIn Live oder ein eigener RTMP-Server sein.
- Zusätzliche Ziele laufen über **Multiple RTMP Outputs (`sorayuki/obs-multi-rtmp`)** und teilen die Hauptencoder.
- Streamschlüssel werden nie über die API ausgegeben, nicht geloggt und nur in Dateien mit Modus `0600` gespeichert.
- Direkte OBS-Dateiänderungen erfolgen nur transaktional mit vorherigem Backup.
- OBS benötigt unter Linux eine aktive X11- oder Wayland-Sitzung; deshalb läuft der Desktop-Agent als `systemd --user`-Dienst.

## Kanalprofil und Hauptziel

Die normale Konfiguration erfolgt im Browser unter **Einstellungen → OBS und Streaming-Ziele** oder direkt unter
`http://localhost:12001/#/obs`. Dort können das Hauptziel und bis zu acht zusätzliche Ziele angelegt, aktiviert und auf
synchronen Start beziehungsweise Stopp gestellt werden. Ein leeres Streamschlüssel-Feld behält einen vorhandenen
Schlüssel; gespeicherte Schlüssel werden nie an den Browser zurückgegeben. Beim Speichern werden `.env`, OBS-Hauptziel
und Multi-RTMP-Konfiguration aktualisiert. Ein zuvor laufender OBS-Prozess wird dafür sicher gestoppt und danach wieder
gestartet; während eines Livestreams ist die Änderung blockiert.

Die direkte `.env`-Konfiguration bleibt für automatisierte Installationen verfügbar.

Beispiel für ein Rumble-Hauptziel:

```dotenv
STUDIO_NAME=Mein TV Studio
CHANNEL_NAME=Mein Kanal
CHANNEL_URL=https://rumble.com/c/mein-kanal
STREAM_PLATFORM=rumble
STREAM_TARGET_NAME=Rumble
STREAM_SERVER=<rtmps-server-aus-dem-creator-dashboard>
STREAM_KEY=<streamschluessel>
STREAM_REQUIRE_RTMPS=true
```

Unterstützte Werte für `STREAM_PLATFORM`:

- `youtube`
- `twitch`
- `tiktok`
- `x`
- `rumble`
- `kick`
- `facebook`
- `linkedin`
- `custom`

YouTube und Twitch besitzen bekannte RTMPS-Standardserver. Für die übrigen Plattformen wird die jeweils im Creator-Dashboard angezeigte Ingest-Adresse eingetragen. Für TikTok werden Server und Streamschlüssel aus dem TikTok LIVE Center übernommen; der Kontoinhaber muss für Encoder-Livestreams freigeschaltet sein.

Die WebUI verlangt standardmäßig verschlüsseltes RTMPS. Zeigt ein Creator-Dashboard – etwa für einzelne TikTok-LIVE-Konten – nur eine `rtmp://`-Adresse, muss die Option **Nur verschlüsselte RTMPS-Server zulassen** bewusst deaktiviert werden. Die Einstellung entspricht `STREAM_REQUIRE_RTMPS=false` und betrifft alle Ziele; vorhandene RTMPS-Adressen bleiben dennoch verschlüsselt.

Status ohne Ausgabe von Geheimnissen:

```bash
npm run studio:channel:status
npm run studio:channel:status -- --json
```

## Zusätzliche Ziele

Zusätzliche Ziele werden als JSON-Array konfiguriert. Für gemeinsam genutzte Beispiele sollten Server, Schlüssel und Kanal-URL über Umgebungsreferenzen eingebunden werden:

```dotenv
RUMBLE_STREAM_SERVER=<rtmps-server>
RUMBLE_STREAM_KEY=<streamschluessel>
RUMBLE_CHANNEL_URL=https://rumble.com/c/mein-kanal
X_STREAM_SERVER=<rtmps-server>
X_STREAM_KEY=<streamschluessel>

STREAM_TARGETS_JSON=[{"id":"rumble","platform":"rumble","name":"Rumble","serverEnv":"RUMBLE_STREAM_SERVER","keyEnv":"RUMBLE_STREAM_KEY","channelUrlEnv":"RUMBLE_CHANNEL_URL"},{"id":"x-live","platform":"x","name":"X Live","serverEnv":"X_STREAM_SERVER","keyEnv":"X_STREAM_KEY"}]
```

Jedes verwaltete Plugin-Ziel erhält eine ID mit dem Präfix `studio-target-`. `npm run obs:configure` ersetzt nur diese Ziele und entfernt bei der Migration das frühere Ziel `argumentationskette-twitch`. Manuell angelegte Plugin-Ziele bleiben unverändert.

Die Zielprüfung kontrolliert für jedes aktive Zusatz-Ziel:

- installiertes Plugin,
- geschützte und lesbare Konfiguration,
- vorhandene Ziel-ID,
- Übereinstimmung von Server und Streamschlüssel,
- synchronen Start und Stopp,
- Verwendung der OBS-Hauptencoder.

Ein fehlerhaftes zusätzliches Ziel blockiert den Start vor dem ersten OBS-WebSocket-Aufruf.

## Installation und Aktualisierung der OBS-Konfiguration

```bash
npm run obs:install-multi-rtmp
systemctl --user stop obs-live-studio-desktop-agent.service || true
npm run obs:configure
npm run studio:preflight -- --scope=obs
systemctl --user restart obs-live-studio.target
```

Das Installationsskript lädt ein passendes Plugin-Archiv aus den offiziellen Releases, prüft Archivpfade, Dateigröße und SHA-256-Digest. Vor OBS-Konfigurationsänderungen wird unter `var/backups/obs-config-*` ein Manifest mit Pfad, Größe, Modus und Prüfsumme erzeugt.
Aktuelle Ubuntu-`.deb`-Pakete für OBS 32 und ältere `.tar.xz`-Pakete werden unterstützt. Die geprüften Dateien werden
ohne `sudo` atomar im benutzerspezifischen OBS-Plugin-Verzeichnis installiert, sodass dieselbe Installation auch aus
dem Setup-Assistenten und aus nicht privilegierten Diensten reproduzierbar bleibt.

## Vorabprüfung

```bash
npm run studio:preflight
npm run studio:preflight -- --scope=configuration
npm run studio:preflight -- --scope=api --json
npm run studio:preflight -- --scope=obs --json
```

Geprüft werden unter anderem:

- Node.js 22 oder neuer,
- `.env` und lokale Geheimnisse,
- Loopback-Bindung von API und Desktop-Agent,
- PostgreSQL,
- OBS-Programm, Profil, Szenensammlung und WebSocket,
- gewählte Hauptplattform und automatischer Streamstart,
- sämtliche zusätzlichen Ziele,
- FFmpeg und TTS-Laufzeit.

Die Prüfung zeigt niemals Streamschlüssel. Schlägt ein `ExecStartPre` fehl, bleibt der betroffene Dienst gestoppt. Diagnose:

```bash
systemctl --user status obs-live-studio-api.service
systemctl --user status obs-live-studio-desktop-agent.service
journalctl --user-unit obs-live-studio-api.service
journalctl --user-unit obs-live-studio-desktop-agent.service
```

## Sprachausgabe mit Piper

```bash
npm run studio:tts:install
npm run studio:tts:status
npm run studio:tts:check
```

`./update.sh` führt die Konfigurationsmigration und diese Laufzeitprüfung automatisch aus. Fehlt bei einem älteren
System Piper oder das Thorsten-Modell, wird es während des Updates nachinstalliert. Der TTS-Button erzeugt einen noch
fehlenden Sprechertext automatisch; Laufzeitfehler erscheinen in der Artikelseite als konkrete Handlungsanweisung und
nicht mehr als allgemeiner HTTP-500-Fehler.

Produktiver Standard:

```dotenv
TTS_ENGINE=piper
PIPER_EXECUTABLE=./var/piper-venv/bin/piper
PIPER_MODEL_PATH=./var/models/piper/de_DE-thorsten-high.onnx
TTS_DEFAULT_VOICE=de_DE-thorsten-high
```

## YouTube-Konto zurücksetzen

Diese Sonderfunktion ist nur sichtbar, wenn YouTube das Hauptziel ist:

```bash
systemctl --user stop obs-live-studio-desktop-agent.service
npm run obs:reset-youtube
systemctl --user start obs-live-studio-desktop-agent.service
```

Sie dient ausschließlich dem legitimen Wechsel des eigenen Kanals. Plattform- oder Kontosperren dürfen nicht durch andere Konten umgangen werden.
