# ArgumentationsKette TV Studio

Lokales Broadcast-Control-Center für einen automatisierten deutschsprachigen Livestream auf YouTube und optional parallel auf Twitch. Das Monorepo verbindet Quellenabruf, vertrauensbasierte Redaktionsregeln, deutsche TTS-Ausgabe, persistente Sendelisten, OBS-WebSocket-Steuerung und veröffentlichte Browser-Overlays.

## Lokale Installation

Unter Ubuntu oder Debian mit Node.js 22:

```bash
./install.sh
```

Das Installationsskript richtet PostgreSQL, FFmpeg, eSpeak NG, OBS Studio, das OBS-Plugin **Multiple RTMP Outputs**, Datenbankmigrationen, offizielle Primärquellen, OBS-Szenen, die `systemd --user`-Dienste sowie einen täglichen Backup- und einen wöchentlichen Wiederherstellungsproben-Timer ein. Vor dem Aktivieren der Dienste wird die vollständige Studio-Vorabprüfung ausgeführt. Danach ist das Control-Center unter `http://127.0.0.1:12001/` erreichbar. Die bei der Erstinstallation erzeugten lokalen Admin-Zugangsdaten stehen mit Dateimodus `0600` in `var/admin-credentials.json`.

## Laufzeit

```bash
systemctl --user status obs-live-studio.target
systemctl --user restart obs-live-studio.target
systemctl --user list-timers 'obs-live-studio-backup*'
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

### Verifizierte Backups

Ein Studio-Backup wird atomar in einem eigenen Verzeichnis angelegt. Es enthält ein komprimiertes Projektarchiv, optional einen PostgreSQL-Dump sowie ein Manifest mit Größe und SHA-256-Prüfsumme aller Artefakte. Unvollständige Sicherungen werden nicht veröffentlicht. Backup-Verzeichnis und Dateien erhalten ausschließlich Eigentümerrechte (`0700` beziehungsweise `0600`). Die `.env` wird nicht als Shell-Code ausgeführt, und das Backup-Verzeichnis selbst wird aus dem Archiv ausgeschlossen.

```bash
npm run studio:backup
npm run studio:backup -- --json
npm run studio:backup:verify -- ./var/backups/studio-20260714T120000Z
npm run studio:backup:rehearse
npm run studio:backup:rehearse -- ./var/backups/studio-20260714T120000Z
```

`BACKUP_RETENTION_DAYS` legt fest, nach wie vielen Tagen vollständig erzeugte Sicherungen entfernt werden; `0` deaktiviert die automatische Bereinigung. Mit `BACKUP_INCLUDE_MEDIA=false` kann das Medienverzeichnis aus dem Projektarchiv ausgeschlossen werden. Da die Sicherung `.env`, Streamkonfigurationen und gegebenenfalls Mediendaten enthalten kann, darf das Backup-Verzeichnis nicht veröffentlicht oder mit anderen Benutzern geteilt werden.

Die Wiederherstellungsprobe prüft zuerst Manifest, Größe, Dateirechte und SHA-256-Prüfsummen. Anschließend entpackt sie das Anwendungsarchiv in einen isolierten temporären Arbeitsbereich, lehnt aus dem Zielbaum herausführende Symlinks und besondere Gerätedateien ab, liest die wiederhergestellte `package.json` und zählt Dateien sowie Datenvolumen. Ein vorhandener PostgreSQL-Custom-Dump wird mit `pg_restore --list` auf eine lesbare Wiederherstellungsstruktur geprüft. Die Live-Installation und die produktive Datenbank werden dabei nicht verändert. Ergebnisse liegen mit Modus `0600` unter `var/backups/rehearsals/`; `latest.json` enthält die zuletzt ausgeführte Probe.

Der OBS-Betriebsstatus überwacht zusätzlich Alter, Lesbarkeit und Dateirechte der Sicherungen. Standardmäßig gilt ein Backup nach 36 Stunden und eine Wiederherstellungsprobe nach 216 Stunden als veraltet. Die Schwellen lassen sich mit `BACKUP_MAX_AGE_HOURS` und `BACKUP_REHEARSAL_MAX_AGE_HOURS` anpassen. Fehlende, veraltete, fehlgeschlagene oder unsicher gespeicherte Sicherungen erscheinen im Control-Center unter **OBS und Livestream**, ohne den Livestream selbst zu blockieren.

Bei der Installation werden zwei Timer aktiviert. `obs-live-studio-backup.timer` startet täglich gegen 03:30 Uhr Ortszeit mit bis zu 30 Minuten zufälliger Verzögerung ein verifiziertes Backup. `obs-live-studio-backup-rehearsal.timer` prüft sonntags gegen 05:30 Uhr mit bis zu einer Stunde zufälliger Verzögerung die Wiederherstellbarkeit des neuesten Backups. Durch `Persistent=true` werden während einer ausgeschalteten Maschine verpasste Läufe nachgeholt. Beide Dienste laufen mit niedriger CPU- und IO-Priorität, restriktiver `UMask` und zusätzlichen systemd-Schutzoptionen.

```bash
systemctl --user status obs-live-studio-backup.timer
systemctl --user status obs-live-studio-backup-rehearsal.timer
systemctl --user list-timers 'obs-live-studio-backup*'
systemctl --user start obs-live-studio-backup.service
systemctl --user start obs-live-studio-backup-rehearsal.service
journalctl --user-unit obs-live-studio-backup.service --since today
journalctl --user-unit obs-live-studio-backup-rehearsal.service --since today
```

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
