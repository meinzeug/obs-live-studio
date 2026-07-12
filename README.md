# Automated News Studio

Deutschsprachiges Monorepo für einen automatisierten 24/7-Nachrichtensender mit Weboberfläche, RSS/Web-Collector, PostgreSQL-Schema, Overlay-Renderer, OBS-WebSocket-Steuerung, lokalem TTS-Adapter, Broadcast-Rundown und Installationsskripten.

## Schnellstart

```bash
cp .env.example .env
npm install
npm run build
npm run dev
```

Standardports: API/Overlay-Fallback `12000`, Web-Frontend `12001`, separater Overlay-Renderer `12002`.

## Struktur

- `apps/web`: deutsches Broadcast-Control-Center mit Dashboard, Overlay-Vorschau und Einrichtungsassistent.
- `apps/api`: Fastify-API, Quellenprüfung, Artikelerstellung, Overlay-Fallback, Control-Actions.
- `apps/worker`: Scheduler-/Worker-Grundprozess.
- `apps/overlay-renderer`: lokale OBS-Browserquellen.
- `apps/desktop-agent`: Linux-Grafiksitzungscheck und OBS-Prozessstart.
- `packages/database`: PostgreSQL-Migrationen und Seed-Daten.
- `packages/*`: Parser, Security, TTS, Medien, Overlay, Broadcast und OBS-Controller.

## Erste Livestream-Schritte

1. Linux-Desktop-Sitzung sicherstellen (`DISPLAY` oder `WAYLAND_DISPLAY`, Audio, GPU, kein Ruhezustand).
2. `.env` ausfüllen, insbesondere `DATABASE_URL`, `OBS_PASSWORD`, `STREAM_SERVER`, `STREAM_KEY`.
3. `npm run db:migrate && npm run db:seed` ausführen.
4. OBS installieren und WebSocket auf Port `4455` aktivieren.
5. Weboberfläche öffnen und Assistenten durchlaufen.
6. RSS-Quelle testen, Beitrag prüfen, TTS erzeugen und Sendebetrieb starten.

## Grenzen

OBS benötigt unter Linux eine echte grafische Sitzung. Ein unterbrochener YouTube-Stream kann technisch nicht immer in derselben Streaminstanz fortgesetzt werden. Das System umgeht keine Paywalls, Captchas, Logins oder Schutzmaßnahmen.
