# Open TV Studio

Lokales, kanalneutrales Broadcast-Control-Center für einen individuellen YouTube-, Twitch-, X-, Rumble-, Kick-, Facebook-Live-, LinkedIn-Live- oder eigenen RTMP-Kanal. Das Monorepo verbindet Quellenabruf, vertrauensbasierte Redaktionsregeln, thematische Video- und Grafikrecherche, deutsche TTS-Ausgabe, persistente Sendelisten, OBS-WebSocket-Steuerung, veröffentlichte Browser-Overlays und ein frei konfigurierbares Haupt- und Multistream-Ausgabemodell.

## Lokale Installation

Unter Ubuntu oder Debian mit Node.js 22:

```bash
./install.sh
```

Das Installationsskript richtet PostgreSQL, FFmpeg, FFprobe, eSpeak NG, OBS Studio, das OBS-Plugin **Multiple RTMP Outputs**, Datenbankmigrationen, offizielle Primärquellen, OBS-Szenen, die `systemd --user`-Dienste sowie einen täglichen Backup- und einen wöchentlichen Wiederherstellungsproben-Timer ein. Die JavaScript-Abhängigkeiten werden reproduzierbar über `npm ci` aus der eingecheckten Sperrdatei installiert. Vor dem Build wird die README-Vertragsprüfung und vor dem Aktivieren der Dienste die vollständige Studio-Vorabprüfung ausgeführt. Danach ist das Control-Center unter `http://127.0.0.1:12001/` erreichbar. Die bei der Erstinstallation erzeugten lokalen Admin-Zugangsdaten stehen mit Dateimodus `0600` in `var/admin-credentials.json`.

Eine neue Installation ist bewusst keinem fremden Kanal zugeordnet. `STUDIO_NAME`, `CHANNEL_NAME`, `CHANNEL_URL`, `STREAM_PLATFORM`, `STREAM_SERVER` und `STREAM_KEY` werden ausschließlich lokal in `.env` gesetzt.

## Laufzeit

```bash
systemctl --user status obs-live-studio.target
systemctl --user restart obs-live-studio.target
systemctl --user list-timers 'obs-live-studio-backup*'
npm run studio:channel:status
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
- OBS-Profil, gewähltes Hauptziel und TTS,
- Installation und Konfiguration von `obs-multi-rtmp`,
- sämtliche zusätzlichen Ziele, synchronen Start/Stopp, Schlüsselabgleich und Encoder-Sharing.

```bash
npm run studio:preflight
npm run studio:preflight -- --scope=configuration
npm run studio:preflight -- --scope=api --json
npm run studio:preflight -- --scope=obs --json
```

Die API- und Desktop-Agent-Dienste verwenden die passende Prüfung als `ExecStartPre`. Bei einem Fehler bleibt der betreffende Dienst gestoppt, statt in einem scheinbar betriebsbereiten Zustand zu laufen. Die Diagnose ist anschließend über `systemctl --user status` oder `journalctl --user-unit` sichtbar. Geheimnisse werden nicht in den Prüfbericht aufgenommen.

### README-Vertragsprüfung

`npm run studio:audit` gleicht die in dieser README zugesagten Kernfunktionen mit den zugehörigen Skripten, Diensten, Timern, Redaktionsregeln und Oberflächen ab. Die Prüfung läuft während der Installation und zu Beginn der CI-Kette. Der aktuelle Audit kontrolliert 41 Verträge. Fehlt beispielsweise ein beworbener Dienst, ein Betriebsbefehl, die aktive Quellenprüfung des Autopiloten, die Warnhinweis-Anzeige, die verbindliche Video- und Medienrecherche, eine sichere OBS-Konfigurationstransaktion, die veraltete-Artefakte-Regel, das Betriebsstörungszentrum, der Quellenmonitor, die GitHub-Actions-Prüfkette oder die generische Multistream-Synchronisierung, bricht die Prüfung mit einem konkreten Vertragsnamen ab.

```bash
npm run studio:audit
npm run studio:audit -- --json
```

Die Vertragsprüfung ergänzt Funktions- und Integrationstests; sie ersetzt keine Laufzeitprüfung gegen PostgreSQL, OBS oder die Streamingplattformen. Die GitHub-Actions-Datei `.github/workflows/ci.yml` führt bei Pull Requests und Änderungen an `main` die vollständige `npm run ci`-Kette in einer reproduzierbaren Playwright-Umgebung aus. Dazu gehören README-Audit, Formatierung, Lint, TypeScript, Build, PostgreSQL-Migration, Unit- und Integrationstests, OBS-Mock, API, Web-UI, Broadcast-Runner und End-to-End-Tests. Bei Fehlern werden Logs, Broadcast-Tabellen und Playwright-Diagnosen als zeitlich begrenztes Artefakt gesichert.

### Sprachausgabe

**TTS erzeugen** bereitet bei Bedarf zuerst automatisch den Sprechertext des Artikels vor und erzeugt anschließend die
Audiodatei. Piper mit der deutschen Stimme `de_DE-thorsten-high` ist der Standard; eine ausdrücklich konfigurierte
eSpeak-NG-Installation bleibt unterstützt. `./update.sh` migriert ältere Standardeinstellungen, installiert oder
repariert eine konfigurierte Piper-Laufzeit samt Modell und prüft Piper beziehungsweise eSpeak sowie FFprobe vor dem
Neustart. Einzelprüfung und Reparatur:

```bash
npm run studio:tts:install
npm run studio:tts:status
npm run studio:tts:check
```

### Störungen, Hinweise und manuelle Quellenabrufe

Das Control-Center besitzt unter **Störungen** ein persistentes Betriebszentrum. Quellenfehler, Medienrecherchefehler und Fehler des Broadcast-Runners werden nicht nur protokolliert, sondern als deduplizierte Meldungen in PostgreSQL gespeichert. Wiederholte identische Störungen erhöhen den Ereigniszähler und aktualisieren den letzten Zeitpunkt, statt die Oberfläche mit Einzelmeldungen zu überfluten. Quellenfehler werden nach mehreren aufeinanderfolgenden Fehlversuchen von einer Warnung zu einem Fehler hochgestuft. Nach einem erfolgreichen Quellenabruf, einer erfolgreichen Videoauswahl beziehungsweise einem wieder stabilen Runner wird die zugehörige Meldung automatisch als behoben markiert.

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

## Redaktion und Autopilot

### OpenRouter und KI-Zauberstab

OpenRouter wird zentral unter **Einstellungen → OpenRouter** verbunden. Der API-Key wird mit Dateimodus `0600` nur in
der lokalen `.env` gespeichert und nie an den Browser zurückgegeben. Jede Aufgabe versucht zuerst den dynamischen
`openrouter/free`-Router. Nur wenn kein geeignetes freies Modell antwortet und der bezahlte Fallback aktiviert ist,
folgt eine eigene budgetierte Paid-Anfrage. Das Studio liest den aktuellen OpenRouter-Modellkatalog, filtert nach
Structured Outputs, Kontextlänge und Preis und wählt ein geeignetes günstiges Flash-, Mini-, Haiku- oder vergleichbares
Modell. Eine atomare PostgreSQL-Reservierung setzt Tages- und Einzelanfragelimit gemeinsam für API, Worker, Ava und Mia
durch. `~latest`-Aliasse dienen nur als kontrollierte Test- und Kompatibilitätsauswahl. Preisobergrenzen je Aufgabe,
strukturierte JSON-Schemata und der konfigurierbare OpenRouter-Datenschutzfilter gelten für jede Anfrage.

Bei aktivierter Eingangsbearbeitung schreibt der Worker neue Meldungen eigenständig um, ordnet sie einem Ressort zu,
erzeugt Einordnung, Kernpunkte, Unsicherheiten, Bildschirmtext, Ticker und Sprechertext und bewahrt den Originalartikel
unverändert auf. KI-Risikohinweise führen weiterhin in die manuelle redaktionelle Prüfung. Scheitert OpenRouter, bleibt
der Artikel erhalten; der Autopilot kann auf die bestehende regelbasierte Aufbereitung zurückfallen.

KI-Zauberstäbe stehen in der Beitragsansicht, der Quelleneinrichtung, der Sendelistenplanung und für ausgewählte
Overlay-Texte bereit. Sendelisten werden nur aus bereits freigegebenen Beiträgen erzeugt. KI-Ausgaben sind Vorschläge
und ersetzen weder Quellenprüfung noch Rechte-, Fakten- oder Freigabeentscheidungen.

Die vollständige Aufgaben- und Modellauswahl ist in [`docs/OPENROUTER_AI.md`](docs/OPENROUTER_AI.md) dokumentiert.

### YouTube Shorts Creator

Unter **Automation → YouTube Shorts Creator** werden qualifizierte Einordnungen aus dem Format „YouTube-Einordnung
mit AVA“ als 1080 × 1920 Pixel große, exakt 90 Sekunden lange Shorts produziert. Ein echtes zeitcodiertes Transkript,
eine fertige KI-Redaktionsanalyse und eine nicht als Fallback erzeugte AVA-Einordnung sind Pflicht. Tageslimit,
PNG-Design, Quellpegel, Titel, Beschreibung, Tags, Sichtbarkeit und Upload-Automatik werden in der WebUI verwaltet.
Automatische Uploads erfolgen ausschließlich nach ausdrücklicher Rechtebestätigung und über eine widerrufbare lokale
YouTube-OAuth-Verbindung. Details stehen in [`docs/YOUTUBE_SHORTS.md`](docs/YOUTUBE_SHORTS.md).

```dotenv
OPENROUTER_API_KEY=<lokaler-api-key>
OPENROUTER_PAID_FALLBACK=true
OPENROUTER_PRESENTER_PAID_FALLBACK=true
OPENROUTER_DAILY_BUDGET_USD=1.00
OPENROUTER_MAX_REQUEST_USD=0.03
OPENROUTER_AUTO_PROCESS_INGEST=true
OPENROUTER_DATA_COLLECTION=deny
```

Der Autopilot verarbeitet ausschließlich Artikel, die:

- aus einer aktuell aktiven und nicht gelöschten Quelle stammen,
- die konfigurierte Vertrauensschwelle erreichen,
- keine kritischen Warnbegriffe enthalten,
- noch nicht ausgespielt oder eingeplant wurden,
- mindestens ein geprüftes lokales Video besitzen,
- bei aktivierter Sendesperre einen laufenden OBS-Livestream vorfinden.

Der Aktivstatus wird unmittelbar vor jeder Auswahl erneut aus PostgreSQL geladen. Das Deaktivieren einer Quelle verhindert daher auch bei bereits eingelesenen Artikeln eine spätere automatische Ausspielung. Eine optionale Quellen-Auswahlliste schränkt die aktiven Quellen zusätzlich ein.

Autopilot, Mindestvertrauen und Livestream-Sperre lassen sich im Dashboard persistent steuern. Offizielle Feeds von Bundesregierung und Deutschem Bundestag werden mit Quellenattribution eingerichtet. Inhalte mit Warnhinweisen bleiben zur manuellen Prüfung im Control-Center: Sie sind in der Nachrichtenliste gekennzeichnet und filterbar; die Detailansicht zeigt die Warnhinweise, den Namen der Quelle, den Originallink, Autor, Veröffentlichungszeit und Vertrauensbewertung. Vor einer manuellen Freigabe eines gewarnten Beitrags verlangt die Oberfläche eine ausdrückliche Bestätigung.

## Videos, Grafiken und Statistiken pro Beitrag

Ein Beitrag aus Text, Standbild und Sprecher-Audio gilt nicht als sendefähig. Nach jedem neuen Artikel wird transaktionssicher ein deduplizierter Medienjob angelegt. Der Worker sucht thematisch passende Videos und Bilder, speichert Herkunft, Urheber, Lizenz, Lizenzlink und Attribution und erzeugt aus geeigneten Zahlen im Artikel automatisch eine 16:9-Statistikkarte.

Unterstützt werden Wikimedia Commons ohne Schlüssel sowie Pexels, Pixabay und die YouTube Data API mit lokal konfigurierten API-Schlüsseln. YouTube-Ergebnisse dienen ausschließlich als redaktionelle Referenz und werden nicht heruntergeladen. Automatische Downloads sind auf bekannte Provider-CDNs, HTTPS, Redirect-Neuprüfung, Größenlimits und einen Gesamttimeout begrenzt. FFprobe prüft Videostream, Dauer und mindestens 640 × 360 Pixel; FFmpeg erzeugt Vorschaubilder.

Die Beitragsansicht bietet Suche, Vorschau, Quellen- und Lizenzlinks, Rechtebestätigung, Import, Ablehnung, Statistik-Erzeugung und einen Eigenvideo-Upload. Ein Eigenvideo wird erst akzeptiert, wenn Urheber, Quelle, Lizenz beziehungsweise Rechtsgrundlage und eine ausdrückliche Rechtebestätigung angegeben wurden.

Die Pflicht wird an vier Stellen durchgesetzt: redaktionelle Freigabe, PostgreSQL-Sendeliste, Autopilot und OBS-Ausspielung. OBS zeigt `ANS_ARTICLE_VIDEO` stumm und wiederholt im Hintergrund, führt `ANS_SPRECHER_AUDIO` als Ton- und Zeitquelle und kann `ANS_ARTICLE_GRAPHIC` als Bild-in-Bild einblenden. Das Hauptoverlay bleibt darüber teiltransparent sichtbar.

Ausführliche Anbieter-, Rechte- und Betriebsinformationen stehen in [`docs/MEDIA_RESEARCH.md`](docs/MEDIA_RESEARCH.md).

```dotenv
MEDIA_COMMONS_ENABLED=true
PEXELS_API_KEY=
PIXABAY_API_KEY=
YOUTUBE_DATA_API_KEY=
MEDIA_AUTO_IMPORT_VIDEO=true
MEDIA_AUTO_IMPORT_GRAPHIC=true
MEDIA_DOWNLOAD_TIMEOUT_MS=120000
MEDIA_MAX_VIDEO_BYTES=262144000
MEDIA_MAX_VIDEO_DURATION_SECONDS=180
```

## Kanal und Hauptplattform

Das Hauptziel und bis zu acht zusätzliche parallele Ziele werden im Browser unter **Einstellungen → OBS und
Streaming-Ziele** beziehungsweise direkt unter `http://localhost:12001/#/obs` bearbeitet. Beim Speichern schreibt das
Studio die private `.env`, aktualisiert das OBS-Profil und die Multi-RTMP-Konfiguration und startet einen zuvor laufenden
OBS-Prozess neu. Während einer laufenden Sendung bleibt die Änderung gesperrt. Bereits gespeicherte Streamschlüssel
werden nie an den Browser zurückgegeben; ein leeres Schlüsselfeld behält den vorhandenen Schlüssel bei.

Alternativ kann das Hauptziel weiterhin direkt über die lokale `.env` gewählt werden:

```dotenv
STUDIO_NAME=Mein TV Studio
CHANNEL_NAME=Mein Kanal
CHANNEL_URL=https://beispiel.invalid/mein-kanal
STREAM_PLATFORM=rumble
STREAM_TARGET_NAME=Rumble
STREAM_SERVER=<rtmps-server-aus-dem-creator-dashboard>
STREAM_KEY=<streamschluessel>
```

Unterstützte Plattformprofile sind `youtube`, `twitch`, `x`, `rumble`, `kick`, `facebook`, `linkedin` und `custom`. Für YouTube und Twitch besitzt das Studio bekannte RTMPS-Standardserver. Für X, Rumble, Kick, Facebook Live und LinkedIn Live werden Server und Schlüssel aus dem jeweiligen Creator-Dashboard eingetragen. Der Streamschlüssel wird weder von der API noch vom Statusbefehl ausgegeben.

Bestehende Installationen mit `YOUTUBE_CHANNEL_URL`, `TWITCH_ENABLED`, `TWITCH_STREAM_SERVER` und `TWITCH_STREAM_KEY` bleiben abwärtskompatibel.

## Zusätzliche Streaming-Ziele

Zusätzliche Ziele werden über das OBS-Plugin **Multiple RTMP Outputs (`sorayuki/obs-multi-rtmp`)** eingerichtet. Das Plugin verwendet den vorhandenen OBS-Hauptencoder und startet beziehungsweise stoppt alle Ziele synchron. Es wird kein zweiter OBS-Prozess gestartet.

Der Installer unterstützt sowohl die aktuellen, für OBS 32 angebotenen Ubuntu-`.deb`-Pakete als auch ältere
`.tar.xz`-Releases. Er prüft Downloadquelle, Größe und SHA-256-Digest und installiert das Plugin ohne Root-Rechte atomar
unter `~/.config/obs-studio/plugins/obs-multi-rtmp`. Ein OBS-Neustart lädt das Plugin; die Vorabprüfung verhindert den
Sendestart, falls Binärdatei, Zielkonfiguration, Schlüssel, Synchronisierung oder Encoder-Sharing nicht konsistent sind.
Beim Speichern eines aktiven parallelen Ziels führt die WebUI diesen Installationsschritt automatisch vor der
OBS-Konfiguration aus.

Die Browser-Oberfläche bietet für jedes zusätzliche Ziel Aktivierung, Plattform, RTMP-/RTMPS-Server, Streamschlüssel,
Kanal-URL sowie synchronen Start und Stopp. Neben den bekannten Profilen nimmt „Benutzerdefiniertes RTMP-Ziel“ jeden
weiteren Anbieter mit einer RTMP- oder RTMPS-Ingest-Adresse auf. Die folgende manuelle Konfiguration bleibt für
automatisierte Installationen und Umgebungsreferenzen verfügbar:

```dotenv
RUMBLE_STREAM_SERVER=<rtmps-server>
RUMBLE_STREAM_KEY=<streamschluessel>
RUMBLE_CHANNEL_URL=https://rumble.com/c/mein-kanal
STREAM_TARGETS_JSON=[{"id":"rumble","platform":"rumble","name":"Rumble","serverEnv":"RUMBLE_STREAM_SERVER","keyEnv":"RUMBLE_STREAM_KEY","channelUrlEnv":"RUMBLE_CHANNEL_URL"}]
```

Mehrere Objekte können im JSON-Array stehen. Erlaubt sind direkte Werte oder Referenzen über `serverEnv`, `keyEnv` und `channelUrlEnv`. Die Verwendung von Umgebungsreferenzen verhindert, dass Schlüssel in gemeinsam genutzten Konfigurationsbeispielen auftauchen.

```bash
npm run studio:channel:status
npm run obs:install-multi-rtmp
systemctl --user stop obs-live-studio-desktop-agent.service || true
npm run obs:configure
npm run studio:preflight -- --scope=obs
systemctl --user restart obs-live-studio.target
```

`npm run obs:configure` pflegt ausschließlich Ziele mit dem Präfix `studio-target-` in `obs-multi-rtmp.json` und entfernt bei der Migration auch das frühere Ziel `argumentationskette-twitch`. Andere manuell angelegte Plugin-Ziele und Encoderprofile bleiben erhalten. Sämtliche vom Studio verwalteten OBS-Dateien werden über eine Transaktion aktualisiert: Vor jeder Inhalts- oder Rechteänderung werden vorhandene Originaldateien unter `var/backups/obs-config-*` gesichert. Das Backup enthält ein Manifest mit Pfad, Größe, ursprünglichem Modus und SHA-256-Prüfsumme. Erst nach erfolgreicher Sicherung werden geänderte Dateien atomar ersetzt. Symbolische Links werden abgewiesen. OBS-Profil, globale Konfiguration, Benutzerkonfiguration, WebSocket-Konfiguration, Szenensammlung, Streamkonfiguration, Plugin-Konfiguration und `.env` werden mit Dateimodus `0600` geschrieben.

Die Video-Encoding-Last wird durch Encoder-Sharing nicht für jedes Ziel erneut erzeugt. Die Internetleitung muss trotzdem die Summe aller parallelen Ausgaben zuzüglich Reserve tragen.

## Struktur

- `apps/api`: Fastify-API, Authentifizierung, Redaktion, Overlays, OBS und Stream-Supervisor
- `apps/web`: produktives Live-Control-Center
- `apps/worker`: Quellenabruf, Medienrecherche und vertrauensbasierter Autopilot
- `apps/broadcast-runner`: persistente, geleaste OBS-Ausspielung
- `apps/desktop-agent`: OBS-Prozess und grafische Linux-Sitzung
- `packages/streaming-platforms`: zentrale Plattform-, Kanal- und Zielprofile
- `packages/*`: Datenbank, Parser, TTS, Overlays, Medien, Security und Broadcast-Engine
- `scripts/*`: Installation, Bootstrap, Vorabprüfung, OBS-, Quellen-, Admin- und Abnahmeautomatisierung

OBS benötigt unter Linux eine echte grafische Sitzung. Paywalls, Captchas, Logins, DRM oder Zugriffsschutz werden nicht umgangen.
