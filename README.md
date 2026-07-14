# ArgumentationsKette TV Studio

Lokales Broadcast-Control-Center für einen automatisierten deutschsprachigen Livestream auf YouTube und optional parallel auf Twitch. Das Monorepo verbindet Quellenabruf, vertrauensbasierte Redaktionsregeln, deutsche TTS-Ausgabe, persistente Sendelisten, OBS-WebSocket-Steuerung und veröffentlichte Browser-Overlays.

## Lokale Installation

Unter Ubuntu oder Debian mit Node.js 22:

```bash
./install.sh
```

Das Installationsskript richtet PostgreSQL, FFmpeg, eSpeak NG, OBS Studio, das OBS-Plugin **Multiple RTMP Outputs**, Datenbankmigrationen, offizielle Primärquellen, OBS-Szenen und die `systemd --user`-Dienste ein. Vor dem Aktivieren der Dienste wird die vollständige Studio-Vorabprüfung ausgeführt. Danach ist das Control-Center unter `http://127.0.0.1:12001/` erreichbar. Die bei der Erstinstallation erzeugten lokalen Admin-Zugangsdaten stehen mit Dateimodus `0600` in `var/admin-credentials.json`.

## Laufzeit

```bash
systemctl --user status obs-live-studio.target
systemctl --user restart obs-live-studio.target
npm run studio:preflight
npm run studio:verify
```

Der Desktop-Agent startet OBS in der grafischen Sitzung und entfernt vorher nur veraltete Crash-Sentinels. API, Web-UI, Worker, Broadcast-Runner und Overlay-Renderer laufen als neu startende Benutzerdienste. Die Dienste funktionieren sowohl mit systemweit installiertem Node.js als auch mit NVM; NVM wird nur geladen, wenn es vorhanden ist.

### Studio-Vorabprüfung

Die Vorabprüfung erkennt unvollständige oder unsichere Installationen, bevor ein Dienst oder eine Sendungsabnahme startet. Sie kontrolliert unter anderem:

- Node.js-Version und benötigte Programme,
- restriktive Rechte für `.env`, OBS-Profile und Streamkonfigurationen,
- Mindestlängen der lokalen Geheimnisse,
- Loopback-Bindung von API und Desktop-Agent,
- Erreichbarkeit von PostgreSQL,
- OBS-Profil, YouTube-Streamkonfiguration und TTS,
- Installation und Konfiguration von `obs-multi-rtmp`,
- Twitch-Ziel, synchronen Start/Stopp, Schlüsselabgleich und Encoder-Sharing.

```bash
npm run studio:preflight
npm run studio:preflight -- --scope=configuration
npm run studio:preflight -- --scope=api --json
npm run studio:preflight -- --scope=obs --json
```

Die API- und Desktop-Agent-Dienste verwenden die passende Prüfung als `ExecStartPre`. Bei einem Fehler bleibt der betreffende Dienst gestoppt, statt in einem scheinbar betriebsbereiten Zustand zu laufen. Die Diagnose ist anschließend über `systemctl --user status` oder `journalctl --user-unit` sichtbar. Geheimnisse werden nicht in den Prüfbericht aufgenommen.

Der Autopilot verarbeitet ausschließlich Artikel, die:

- aus einer aktiven Quelle stammen,
- die konfigurierte Vertrauensschwelle erreichen,
- keine kritischen Warnbegriffe enthalten,
- noch nicht ausgespielt oder eingeplant wurden,
- bei aktivierter Sendesperre einen laufenden OBS-Livestream vorfinden.

Autopilot, Mindestvertrauen und Livestream-Sperre lassen sich im Dashboard persistent steuern. Offizielle Feeds von Bundesregierung und Deutschem Bundestag werden mit Quellenattribution eingerichtet. Inhalte mit Warnhinweisen bleiben zur manuellen Prüfung im Control-Center.

## YouTube

Die reguläre OBS-Ausgabe verwendet YouTube RTMPS. Streamschlüssel und die abschließende Kanalautorisierung werden lokal in OBS beziehungsweise YouTube Studio hinterlegt und niemals in Git gespeichert. Danach halten `STREAM_AUTO_START=true` und `STREAM_AUTO_RESTART=true` die Hauptausgabe aktiv.

## YouTube und Twitch parallel

Twitch wird über das OBS-Plugin **Multiple RTMP Outputs (`sorayuki/obs-multi-rtmp`)** als zusätzliches RTMP-Ziel eingerichtet. Das Plugin verwendet den vorhandenen OBS-Streamingencoder und startet beziehungsweise stoppt Twitch synchron mit der YouTube-Hauptausgabe. Es wird kein zweiter OBS-Prozess gestartet und kein zweiter Videoencoder angelegt.

Die geheimen Schlüssel gehören ausschließlich in die lokale `.env`:

```dotenv
STREAM_SERVER=rtmps://a.rtmps.youtube.com:443/live2
STREAM_KEY=<youtube-streamschluessel>
TWITCH_ENABLED=true
TWITCH_STREAM_SERVER=rtmps://live.twitch.tv:443/app
TWITCH_STREAM_KEY=<twitch-streamschluessel>
```

Danach Plugin und Profil konfigurieren und den Zustand prüfen:

```bash
npm run obs:install-multi-rtmp
systemctl --user stop obs-live-studio-desktop-agent.service || true
npm run obs:configure
npm run studio:preflight -- --scope=obs
systemctl --user restart obs-live-studio.target
```

`npm run obs:configure` pflegt ausschließlich das verwaltete Twitch-Ziel mit der ID `argumentationskette-twitch` in `obs-multi-rtmp.json`. Andere manuell angelegte Plugin-Ziele und Encoderprofile bleiben erhalten. Vor jeder Änderung wird eine Sicherung unter `var/backups/` angelegt. Die Profil- und Umgebungsdateien werden mit Dateimodus `0600` geschrieben.

Die Video-Encoding-Last wird nicht verdoppelt, weil Twitch den Hauptencoder teilt. Die Internetleitung muss trotzdem die zusätzliche Twitch-Ausgabe tragen; bei 6 Mbit/s Videobitrate plus Audio sind für zwei Plattformen deutlich mehr als 12 Mbit/s stabiler Upload sinnvoll.

## Struktur

- `apps/api`: Fastify-API, Authentifizierung, Redaktion, Overlays, OBS und Stream-Supervisor
- `apps/web`: produktives Live-Control-Center
- `apps/worker`: Quellenabruf und vertrauensbasierter Autopilot
- `apps/broadcast-runner`: persistente, geleaste OBS-Ausspielung
- `apps/desktop-agent`: OBS-Prozess und grafische Linux-Sitzung
- `packages/*`: Datenbank, Parser, TTS, Overlays, Medien, Security und Broadcast-Engine
- `scripts/*`: Installation, Bootstrap, Vorabprüfung, OBS-, Quellen-, Admin- und Abnahmeautomatisierung

OBS benötigt unter Linux eine echte grafische Sitzung. Paywalls, Captchas, Logins oder Zugriffsschutz werden nicht umgangen.
