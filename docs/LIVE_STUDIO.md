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
