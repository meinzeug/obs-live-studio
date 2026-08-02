# Datensicherung und Wiederherstellung

OBS Live Studio erzeugt atomare, verifizierte Sicherungen unter
`BACKUP_DIRECTORY` (standardmäßig `./var/backups`). Jeder erfolgreiche Lauf
enthält `app.tar.gz`, optional `database.dump` und ein `manifest.json` mit
Größe, Modus und SHA-256-Prüfsumme. Ein Verzeichnis wird erst nach erfolgreicher
Verifikation als `studio-YYYYMMDDTHHMMSSZ` veröffentlicht.

## Gesicherte Daten

Standardmäßig enthält das Anwendungsarchiv:

- Quellcode, Workspace-Konfiguration und Installationsskripte,
- die private `.env` und sonstige Studio-Konfiguration,
- Branding, Logos und nicht generierte Projektdateien,
- `var/media`, solange `BACKUP_INCLUDE_MEDIA=true` gesetzt ist,
- weitere nicht ausgeschlossene Benutzerdaten.

Bei gesetzter `DATABASE_URL` wird zusätzlich ein PostgreSQL-Custom-Dump
erstellt. Darin liegen unter anderem Artikel, Quellen, Sendepläne,
Overlay-Metadaten, Sprechertexte, Einstellungen und Auditdaten.

Das Backup-Verzeichnis kann Secrets und urheberrechtlich geschützte Medien
enthalten. Es muss privat (`0700` für Verzeichnisse, `0600` für Dateien) und
außerhalb eines öffentlich ausgelieferten Pfads bleiben.

## Standardmäßig ausgeschlossene Daten

Die zentrale, von Archiv und Platzschätzung gemeinsam verwendete Liste steht
als `DEFAULT_BACKUP_EXCLUDES` in `scripts/studio-backup-lib.mjs`. Ausgeschlossen
sind insbesondere:

- `.git`, `node_modules`, Build-, Test- und Coverage-Ausgaben,
- `var/*-venv`, `var/models` und `var/pocket-tts`,
- `var/yt-dlp` und `var/bgutil-ytdlp-pot-provider`,
- `var/tts`,
- Cache-, Log-, Render-, Download- und temporäre Verzeichnisse,
- das Backup-Verzeichnis selbst.

Die Dateien in `var/tts` sind generierte WAV-/Testausgaben. Ihre Texte,
Provider- und Stimmenkonfiguration sowie Asset-Metadaten liegen dauerhaft in
PostgreSQL. Nach einer Wiederherstellung erzeugt der normale TTS-Workflow
fehlende Audios neu. Python-Umgebungen, Modelle und YouTube-Werkzeuge werden
über die Installationsskripte aus dem Repository rekonstruiert, zum Beispiel
mit den jeweiligen `studio:tts:install:*`-Skripten beziehungsweise
`scripts/install-youtube-tools.sh`.

`BACKUP_EXTRA_INCLUDE_PATHS` hebt für explizit genannte, relative Teilbäume
einen Standardausschluss auf. `BACKUP_EXTRA_EXCLUDE_PATHS` ergänzt die
Ausschlussliste. Mehrere Pfade werden durch Komma, Semikolon oder Zeilenumbruch
getrennt. Absolute Pfade und Pfade mit `..` werden abgewiesen. Ein Include
eines Teilpfads unter einem ausgeschlossenen Verzeichnis hebt aus technischen
Gründen den Ausschluss für diesen Teilbaum auf; deshalb anschließend die
Backup-Größe kontrollieren.

## Platzprüfung vor dem Archiv

Der Backup-Lauf schreibt vor dem Platzcheck weder Probe- noch Staging-Archive.
Er führt in dieser Reihenfolge aus:

1. exklusives Backup-Lock übernehmen und nach einem Prozessabsturz ein
   verwaistes Lock sicher erkennen,
2. unvollständige `.studio-backup-*`-Verzeichnisse entfernen,
3. abgelaufene oder überzählige, bereits verifizierte Backups vorab bereinigen,
4. die Größe aller tatsächlich einzuschließenden Dateien ohne Schreibzugriff
   summieren,
5. für das Anwendungsarchiv 120 Prozent dieser Größe plus 64 MiB Overhead
   ansetzen,
6. einen vorhandenen Datenbank-Dump mit 120 Prozent des letzten Dump-Artefakts,
   beim ersten Lauf konservativ mit 1 GiB, schätzen,
7. freien Platz über `statfs` auf genau dem Dateisystem des Backup-Verzeichnisses
   prüfen.

Erst wenn `frei >= geschätztes Backup + Sicherheitsreserve` gilt, wird das
Staging-Verzeichnis angelegt und `tar` gestartet. Bei Platzmangel nennt die
Fehlermeldung freien, geschätzten, reservierten und insgesamt benötigten
Speicher. Das neueste erfolgreich verifizierte Backup wird nie gelöscht, um
Platz für ein neues zu erzwingen. Kann die Grenze deshalb nicht eingehalten
werden, endet der Lauf sicher und ohne neues Archiv.

## Aufbewahrungsregeln

| Variable | Standard | Bedeutung |
| --- | ---: | --- |
| `BACKUP_DIRECTORY` | `./var/backups` | Ziel auf dessen Dateisystem geprüft wird |
| `BACKUP_RETENTION_DAYS` | `14` | Alter vollständiger Backups; `0` deaktiviert nur diese Regel |
| `BACKUP_MAX_COUNT` | `2` | Maximale Zahl vollständiger Backups; `0` deaktiviert nur diese Regel |
| `BACKUP_MAX_TOTAL_BYTES` | `0` | Optionales Gesamtvolumen; `0` deaktiviert die Byte-Grenze |
| `BACKUP_MIN_FREE_GB` | `10` | Freie Sicherheitsreserve nach der geschätzten Erstellung |
| `BACKUP_MIN_FREE_BYTES` | leer | Exakte Alternative mit Vorrang vor `BACKUP_MIN_FREE_GB` |
| `BACKUP_INCLUDE_MEDIA` | `true` | `var/media` in das Archiv aufnehmen |
| `BACKUP_EXTRA_INCLUDE_PATHS` | leer | Standardausschlüsse gezielt aufheben |
| `BACKUP_EXTRA_EXCLUDE_PATHS` | leer | Weitere relative Pfade ausschließen |

Vor und nach erfolgreicher Erstellung werden Alter, Zahl und optionales
Gesamtvolumen angewendet. Automatisch gelöscht werden ausschließlich
vollständige Verzeichnisse mit gültigem Manifest, privaten Rechten und
erfolgreicher Prüfsumme. Beschädigte oder fremde Verzeichnisse werden zur
manuellen Untersuchung stehen gelassen.

Für eine Systempartition mit ungefähr 98 GiB ist folgende Konfiguration ein
sicherer Ausgangspunkt:

```dotenv
BACKUP_DIRECTORY=./var/backups
BACKUP_RETENTION_DAYS=7
BACKUP_MAX_COUNT=1
BACKUP_MAX_TOTAL_BYTES=10737418240
BACKUP_MIN_FREE_GB=5
BACKUP_INCLUDE_MEDIA=true
BACKUP_EXTRA_INCLUDE_PATHS=
BACKUP_EXTRA_EXCLUDE_PATHS=
```

Sind Medien bereits unabhängig gesichert oder vollständig erneut importierbar,
kann `BACKUP_INCLUDE_MEDIA=false` die Sicherung weiter verkleinern. Nicht
rekonstruierbare Uploads dürfen nur nach einer externen Mediensicherung
ausgeschlossen werden.

## Bedienung und Wiederherstellungsprobe

```bash
npm run studio:backup
npm run studio:backup -- --json
npm run studio:backup:verify -- ./var/backups/studio-20260714T120000Z
npm run studio:backup:rehearse
npm run studio:backup:rehearse -- ./var/backups/studio-20260714T120000Z
```

Die Probe entpackt in einen isolierten temporären Arbeitsbereich, prüft
unsichere Pfade, Symlinks und Gerätedateien und validiert einen Datenbank-Dump
mit `pg_restore --list`. Produktivverzeichnis und Datenbank werden dabei nicht
verändert. Erst für eine echte Wiederherstellung werden `app.tar.gz` in ein
leeres Ziel entpackt, Abhängigkeiten und ausgeschlossene Laufzeiten neu
installiert und `database.dump` in eine dafür vorbereitete PostgreSQL-Datenbank
eingespielt.

## Timer und Fehlerfall

`obs-live-studio-backup.timer` läuft täglich gegen 03:30 Uhr,
`obs-live-studio-backup-rehearsal.timer` wöchentlich. Beide lesen dieselbe
geschützte `.env`. Ein Platzabbruch ist ein fehlgeschlagener systemd-Lauf und
im Journal sichtbar, lässt aber das letzte gültige Backup und den Sendebetrieb
unangetastet:

```bash
systemctl --user status obs-live-studio-backup.service
journalctl --user-unit obs-live-studio-backup.service --since today
systemctl --user list-timers 'obs-live-studio-backup*'
```

Vor einer manuellen Änderung oder Auslagerung produktiver Backups immer
`npm run studio:backup:verify -- <Pfad>` ausführen. Der Backup-Prozess selbst
löscht keine Mediendateien.

## Reduzierte API-Zugriffsprotokolle

Fastifys automatische Meldungen für Request-Eingang und -Abschluss sind
deaktiviert. Das Studio schreibt pro relevantem Request höchstens eine eigene
Abschlussmeldung. Erfolgreiche Polling-, Overlay- und SSE-Zugriffe werden im
Produktionsmodus nur stichprobenartig erfasst; Statusfehler, 4xx-/5xx-Antworten,
langsame Requests und fachliche Zustandsänderungen bleiben sichtbar.

```dotenv
API_REQUEST_LOGGING=sampled
API_REQUEST_LOG_SAMPLE_RATE=0.01
API_SLOW_REQUEST_MS=2000
```

`API_REQUEST_LOGGING=all` protokolliert alle erfolgreichen Zugriffe,
`sampled` nur die konfigurierte Polling-Stichprobe und
`errors`/`off` nur Fehler sowie langsame Requests. Die Stichprobenrate liegt
zwischen `0` und `1`; `0.01` entspricht ungefähr einem Prozent.
