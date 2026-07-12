# ArgumentationsKette TV Studio

Lokales Broadcast-Control-Center für einen automatisierten deutschsprachigen YouTube-Livestream. Das Monorepo verbindet Quellenabruf, vertrauensbasierte Redaktionsregeln, deutsche TTS-Ausgabe, persistente Sendelisten, OBS-WebSocket-Steuerung und veröffentlichte Browser-Overlays.

## Lokale Installation

Unter Ubuntu oder Debian mit Node.js 22:

```bash
./install.sh
```

Das Installationsskript richtet PostgreSQL, FFmpeg, eSpeak NG, OBS Studio, Datenbankmigrationen, offizielle Primärquellen, OBS-Szenen und die `systemd --user`-Dienste ein. Danach ist das Control-Center unter `http://127.0.0.1:12001/` erreichbar. Die bei der Erstinstallation erzeugten lokalen Admin-Zugangsdaten stehen mit Dateimodus `0600` in `var/admin-credentials.json`.

## Laufzeit

```bash
systemctl --user status obs-live-studio.target
systemctl --user restart obs-live-studio.target
npm run studio:verify
```

Der Desktop-Agent startet OBS in der grafischen Sitzung und entfernt vorher nur veraltete Crash-Sentinels. API, Web-UI, Worker, Broadcast-Runner und Overlay-Renderer laufen als neu startende Benutzerdienste.

Der Autopilot verarbeitet ausschließlich Artikel, die:

- aus einer aktiven Quelle stammen,
- die konfigurierte Vertrauensschwelle erreichen,
- keine kritischen Warnbegriffe enthalten,
- noch nicht ausgespielt oder eingeplant wurden,
- bei aktivierter Sendesperre einen laufenden OBS-Livestream vorfinden.

Autopilot, Mindestvertrauen und Livestream-Sperre lassen sich im Dashboard persistent steuern. Offizielle Feeds von Bundesregierung und Deutschem Bundestag werden mit Quellenattribution eingerichtet. Inhalte mit Warnhinweisen bleiben zur manuellen Prüfung im Control-Center.

## YouTube

Die OBS-Ausgabe verwendet YouTube RTMPS. Streamschlüssel und die abschließende Kanalautorisierung werden manuell in OBS beziehungsweise YouTube Studio hinterlegt und niemals in Git gespeichert. Danach halten `STREAM_AUTO_START=true` und `STREAM_AUTO_RESTART=true` die Ausgabe aktiv.

## Struktur

- `apps/api`: Fastify-API, Authentifizierung, Redaktion, Overlays, OBS und Stream-Supervisor
- `apps/web`: produktives Live-Control-Center
- `apps/worker`: Quellenabruf und vertrauensbasierter Autopilot
- `apps/broadcast-runner`: persistente, geleaste OBS-Ausspielung
- `apps/desktop-agent`: OBS-Prozess und grafische Linux-Sitzung
- `packages/*`: Datenbank, Parser, TTS, Overlays, Medien, Security und Broadcast-Engine
- `scripts/*`: Installation, Bootstrap, OBS-, Quellen-, Admin- und Abnahmeautomatisierung

OBS benötigt unter Linux eine echte grafische Sitzung. Paywalls, Captchas, Logins oder Zugriffsschutz werden nicht umgangen.
