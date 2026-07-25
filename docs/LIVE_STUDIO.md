# Live Studio

Der Bereich `/#/live` steuert Live-Zuschaltungen ueber das externe Portal `https://obs.meinzeug.cloud`.

## Datenfluss

1. Benutzer senden Kamera und Mikrofon im Portal per LiveKit in einen Quellenraum.
2. `obs-live-studio` ruft aktive Quellen serverseitig ueber `LIVE_PORTAL_BASE_URL` und `LIVE_PORTAL_SERVICE_TOKEN` ab.
3. Beim Hinzufuegen erzeugt das Portal eine widerrufbare OBS-Viewer-URL.
4. Der `ObsController` erstellt in `08_LIVE_STUDIO` eine Browser-Source pro Quelle mit stabilem Namen `ANS_LIVE_<sourceId>`.
5. Das Overlay-System nutzt den Slot `live-studio` mit `ANS_LIVE_OVERLAY`.

Die WebUI spricht nie direkt mit OBS und bekommt kein Portal-Service-Token.

## OBS-Namen

- Szene: `08_LIVE_STUDIO`
- Overlay-Input: `ANS_LIVE_OVERLAY`
- Quellen-Inputs: `ANS_LIVE_<normalisierte-source-id>`

Jede Quelle ist eine eigene Browser-Source mit `reroute_audio=true`, damit Audio in OBS separat stummgeschaltet und gemischt werden kann.

## Environment

```bash
LIVE_PORTAL_BASE_URL=https://obs.meinzeug.cloud
LIVE_PORTAL_SERVICE_TOKEN=<secret aus obs-live-studio-web>
LIVE_PORTAL_TIMEOUT_MS=8000
```

## Direktleitung zwischen Regie und Streamer

Jede Portal-Quelle besitzt in der Quellenliste einen **Regie-Chat**. Die Redaktion kann freie Nachrichten
oder vorbereitete Hinweise wie „Gleich live“, „Lauter sprechen“ und „Zum Ende kommen“ senden. Wichtigkeit und
Dringlichkeit werden sichtbar übertragen. Der Streamer erhält im Portal Browserbenachrichtigungen und
Vibration, sofern er dies freigibt, und kann mit Schnellantworten reagieren oder einen Regiehinweis
ausdrücklich bestätigen.

Die Regie sieht Lesebestätigungen und eine Zahl ungelesener Streamer-Nachrichten direkt an der Quelle. Das
Chatfenster fragt nur während es geöffnet ist in kurzem Abstand nach neuen Nachrichten; der normale
Live-Status lädt eine kompakte Zusammenfassung.

OBS-Aktionen synchronisieren zusätzlich den Tally-Zustand:

- `Standby`: Quelle ist in OBS angelegt, aber weder Vorschau noch Programm.
- `Vorschau`: Quelle liegt in der Regievorschau und soll sich bereithalten.
- `Programm`: Quelle ist auf Sendung.
- `Ton stumm`: Der Streamer sieht, dass sein Ton in OBS stummgeschaltet ist.

Der `LIVE_PORTAL_SERVICE_TOKEN` bleibt dabei ausschließlich im API-Prozess von `obs-live-studio`. Browser
sprechen nur mit den authentifizierten `/api/live/sources/:sourceId/...`-Routen des Studios; diese verlangen
die Berechtigung `obs:write`.

Über **Gast einladen** erstellt die Regie direkt im Quellenbereich einen einmaligen Portal-Link. Der Gast
vergibt darüber selbst Benutzername und sicheres Passwort; Portal-Benutzer und Live-Quelle entstehen
atomar beim Annehmen. Der geheime Link wird der Regie nur unmittelbar nach dem Erstellen vollständig
angezeigt. Offene Links lassen sich in der Einladungsübersicht sofort widerrufen. Danach kann die Redaktion
die neue Quelle bereits im Standby anschreiben; in OBS übernehmen lässt sie sich erst bei einem frischen
Live-Heartbeat.

## Bedienung

- `Live-Modus` erstellt die Szene und stellt das Live-Overlay bereit.
- `In OBS` fuegt eine aktive Portal-Quelle als Browser-Source hinzu.
- Layouts: `fullscreen`, `split`, `grid`, `pip`.
- Quellen koennen stummgeschaltet, ausgeblendet, in Vorschau markiert oder ins Programm uebernommen werden.
- `Streaming starten` setzt die Live-Szene und startet danach den OBS-Stream kontrolliert ueber den `ObsController`.

## Rollback

Die Migration `013_live_studio.sql` ist additiv. Ein Rollback der Funktionalitaet besteht aus:

```bash
git checkout <known-good-commit>
npm run build
sudo systemctl restart obs-live-studio-api.service obs-live-studio-web.service
```

Die Tabellen `live_studio_settings` und `live_studio_sources` koennen bestehen bleiben; sie werden von aelteren Versionen ignoriert.
