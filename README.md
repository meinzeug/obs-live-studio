# ArgumentationsKette TV Studio

Lokales Broadcast-Control-Center für einen automatisierten deutschsprachigen Livestream auf YouTube und optional parallel auf Twitch. Das Monorepo verbindet Quellenabruf, vertrauensbasierte Redaktionsregeln, deutsche TTS-Ausgabe, persistente Sendelisten, OBS-WebSocket-Steuerung und veröffentlichte Browser-Overlays.

## Lokale Installation

Unter Ubuntu oder Debian mit Node.js 22:

```bash
./install.sh
```

Das Installationsskript richtet PostgreSQL, FFmpeg, eSpeak NG, OBS Studio, das OBS-Plugin **Multiple RTMP Outputs**, Datenbankmigrationen, offizielle Primärquellen, OBS-Szenen, die `systemd --user`-Dienste sowie einen täglichen Backup- und einen wöchentlichen Wiederherstellungsproben-Timer ein. Die JavaScript-Abhängigkeiten werden reproduzierbar über `npm ci` aus der eingecheckten Sperrdatei installiert. Vor dem Build wird die README-Vertragsprüfung und vor dem Aktivieren der Dienste die vollständige Studio-Vorabprüfung ausgeführt. Danach ist das Control-Center unter `http://127.0.0.1:12001/` erreichbar. Die bei der Erstinstallation erzeugten lokalen Admin-Zugangsdaten stehen mit Dateimodus `0600` in `var/admin-credentials.json`.

## Laufzeit

```bash
systemctl --user status obs-live-studio.target
systemctl --user restart obs-live-studio.target
systemctl --user list-timers 'obs-live-studio-backup*'
npm run studio:preflight
npm run studio:verify
npm run studio:audit
```

Der Desktop-Agent startet OBS in der grafischen Sitzung. Vor einem Start erkennt er bereits außerhalb des Agents laufende OBS-Prozesse und verhindert dadurch einen zweiten konkurrierenden OBS-Prozess. Crash-Sentinels und Chromium-Singleton-Dateien werden nur entfernt, wenn kein OBS-Prozess läuft und die Dateien mindestens `OBS_STALE_ARTIFACT_MIN_AGE_MS` alt sind; der Standardwert beträgt 1000 Millisekunden. Die lokale OBS-PID-Datei und ihr Verzeichnis werden mit `0600` beziehungsweise `0700` geschützt. API, Web-UI, Worker, Broadcast-Runner und Overlay-Renderer laufen als neu startende Benutzerdienste. Die Dienste funktionieren sowohl mit systemweit installiertem Node.js als auch mit NVM; NVM wird nur geladen, wenn es vorhanden ist.

### Studio-Vorabprüfung

Die Vorabprüfung erkennt unvollständige oder unsichere Installationen, bevor ein Dienst oder eine Sendungsabnahme startet. Sie kontrolliert unter anderem:

- Node.js-Version und benötigte Programme,
- restriktive Rechte für `.env`, OBS-Profile und Streamkonfigurationen,
- globale OBS-Konfiguration, Benutzerkonfiguration, WebSocket-Konfiguration und Szenensammlung,
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

### README-Vertragsprüfung

`npm run studio:audit` gleicht die in dieser README zugesagten Kernfunktionen mit den zugehörigen Skripten, Diensten, Timern, Redaktionsregeln und Oberflächen ab. Die Prüfung läuft während der Installation und zu Beginn der CI-Kette. Der aktuelle Audit kontrolliert 39 Verträge. Fehlt beispielsweise ein beworbener Dienst, ein Betriebsbefehl, die aktive Quellenprüfung des Autopiloten, die Warnhinweis-Anzeige, eine sichere OBS-Konfigurationstransaktion, die veraltete-Artefakte-Regel, das Betriebsstörungszentrum, der Quellenmonitor, die GitHub-Actions-Prüfkette oder die Twitch-Synchronisierung, bricht die Prüfung mit einem konkreten Vertragsnamen ab.

```bash
npm run studio:audit
npm run studio:audit -- --json
```

Die Vertragsprüfung ergänzt Funktions- und Integrationstests; sie ersetzt keine Laufzeitprüfung gegen PostgreSQL, OBS oder die Streamingplattformen. Die GitHub-Actions-Datei `.github/workflows/ci.yml` führt bei Pull Requests und Änderungen an `main` die vollständige `npm run ci`-Kette in einer reproduzierbaren Playwright-Umgebung aus. Dazu gehören README-Audit, Formatierung, Lint, TypeScript, Build, PostgreSQL-Migration, Unit- und Integrationstests, OBS-Mock, API, Web-UI, Broadcast-Runner und End-to-End-Tests. Bei Fehlern werden Logs, Broadcast-Tabellen und Playwright-Diagnosen als zeitlich begrenztes Artefakt gesichert.

### Störungen, Hinweise und manuelle Quellenabrufe

Das Control-Center besitzt unter **Störungen** ein persistentes Betriebszentrum. Quellenfehler und Fehler des Broadcast-Runners werden nicht nur protokolliert, sondern als deduplizierte Meldungen in PostgreSQL gespeichert. Wiederholte identische Störungen erhöhen den Ereigniszähler und aktualisieren den letzten Zeitpunkt, statt die Oberfläche mit Einzelmeldungen zu überfluten. Quellenfehler werden nach mehreren aufeinanderfolgenden Fehlversuchen von einer Warnung zu einem Fehler hochgestuft. Nach einem erfolgreichen Quellenabruf beziehungsweise einem wieder stabilen Runner wird die zugehörige Meldung automatisch als behoben markiert.

Der Lesestatus wird je Benutzer geführt. Das Dashboard und die Seitenleiste zeigen die Anzahl der noch nicht quittierten offenen Meldungen. Im Betriebszentrum können einzelne oder alle offenen Meldungen quittiert und auf Wunsch auch bereits behobene Ereignisse angezeigt werden. Meldungen enthalten nur betriebliche Details wie Komponente, Fehlertext, Fehlversuche und nächsten Wiederholungszeitpunkt; Streamschlüssel und andere Geheimnisse werden nicht aufgenommen.

In der Quellenverwaltung kann jede Quelle unmittelbar über **Jetzt abrufen** in die persistente Worker-Warteschlange gestellt werden. Der vorhandene Eindeutigkeitsschutz verhindert parallele doppelte Abrufe derselben Quelle. Quellen können außerdem direkt pausiert und erneut aktiviert werden. Manuelle Abrufe und Quittierungen werden im Audit-Protokoll erfasst.

### Quellenmonitor und Abrufdiagnose

Unter **Quellenmonitor** wertet das Control-Center die bereits persistent gespeicherten `source_checks` aus. Für frei wählbare Zeiträume von sechs Stunden bis 30 Tagen zeigt es pro Quelle Verfügbarkeit, durchschnittliche und maximale Abrufdauer, erfolgreiche und fehlgeschlagene Prüfungen, aktuelle Fehlerfolgen, den letzten Prüfzeitpunkt und einen überfälligen nächsten Abruf. Der Gesamtüberblick fasst stabile, beeinträchtigte, ausgefallene, pausierte und noch nicht gemessene Quellen zusammen.

Eine Quelle gilt als ausgefallen, wenn mindestens drei aktuelle Abrufe in Folge scheitern. Sie gilt als beeinträchtigt, wenn ein aktueller Fehler vorliegt, die Verfügbarkeit im gewählten Zeitraum unter 95 Prozent fällt oder ein erwarteter Abruf einschließlich einer Toleranz von mindestens fünf Minuten ausbleibt. Historische Einzelfehler halten eine inzwischen wieder stabile Quelle nicht dauerhaft im Warnzustand. Bereits vorhandene Prüfungen ohne Laufzeitmessung bleiben sichtbar; neue Abrufe speichern zusätzlich ihre Gesamtdauer. Auch HTTP-Antworten mit unverändertem Inhalt werden als erfolgreiche Prüfung erfasst.

Der detaillierte Prüfverlauf zeigt HTTP-Status, Dauer, erkannte und neu gespeicherte Beiträge, unveränderte Antworten und bereinigte Fehlertexte. Berechtigte Benutzer können direkt aus dem Monitor einen erneuten Abruf in die vorhandene deduplizierte Worker-Warteschlange stellen. Ein zusätzlicher Datenbankindex beschleunigt die zeitbasierte Auswertung großer Prüfverläufe.

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

- aus einer aktuell aktiven und nicht gelöschten Quelle stammen,
- die konfigurierte Vertrauensschwelle erreichen,
- keine kritischen Warnbegriffe enthalten,
- noch nicht ausgespielt oder eingeplant wurden,
- bei aktivierter Sendesperre einen laufenden OBS-Livestream vorfinden.

Der Aktivstatus wird unmittelbar vor jeder Auswahl erneut aus PostgreSQL geladen. Das Deaktivieren einer Quelle verhindert daher auch bei bereits eingelesenen Artikeln eine spätere automatische Ausspielung. Eine optionale Quellen-Auswahlliste schränkt die aktiven Quellen zusätzlich ein.

Autopilot, Mindestvertrauen und Livestream-Sperre lassen sich im Dashboard persistent steuern. Offizielle Feeds von Bundesregierung und Deutschem Bundestag werden mit Quellenattribution eingerichtet. Inhalte mit Warnhinweisen bleiben zur manuellen Prüfung im Control-Center: Sie sind in der Nachrichtenliste gekennzeichnet und filterbar; die Detailansicht zeigt die Warnhinweise, den Namen der Quelle, den Originallink, Autor, Veröffentlichungszeit und Vertrauensbewertung. Vor einer manuellen Freigabe eines gewarnten Beitrags verlangt die Oberfläche eine ausdrückliche Bestätigung.

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

`npm run obs:configure` pflegt ausschließlich das verwaltete Twitch-Ziel mit der ID `argumentationskette-twitch` in `obs-multi-rtmp.json`. Andere manuell angelegte Plugin-Ziele und Encoderprofile bleiben erhalten. Sämtliche vom Studio verwalteten OBS-Dateien werden über eine Transaktion aktualisiert: Vor jeder Inhalts- oder Rechteänderung werden vorhandene Originaldateien unter `var/backups/obs-config-*` gesichert. Das Backup enthält ein Manifest mit Pfad, Größe, ursprünglichem Modus und SHA-256-Prüfsumme. Erst nach erfolgreicher Sicherung werden geänderte Dateien atomar ersetzt. Symbolische Links werden abgewiesen. OBS-Profil, globale Konfiguration, Benutzerkonfiguration, WebSocket-Konfiguration, Szenensammlung, Streamkonfiguration, Plugin-Konfiguration und `.env` werden mit Dateimodus `0600` geschrieben.

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
