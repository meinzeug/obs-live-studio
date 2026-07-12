# QUICKSTART

Diese Dokumentation beschreibt den Stand des lauffähigen Grundsystems und die produktionsrelevanten Regeln.

## Kernpunkte

- Alle Bedienoberflächen sind deutschsprachig geplant und im Grundsystem unter `apps/web` angelegt.
- OBS wird ausschließlich über ein eigenes Profil und eine eigene Szenensammlung genutzt: **Automated News Studio**.
- Direkte OBS-Dateiänderungen dürfen nur bei beendetem OBS und nach Backup erfolgen; im Betrieb wird OBS WebSocket verwendet.
- Quellenabrufe respektieren SSRF-Schutz, robots-/Nutzungsgrenzen und umgehen keine Paywalls, Logins oder Captchas.
- Fremde Artikel werden nicht vollständig neu veröffentlicht; das System erzeugt neutrale Zusammenfassungen mit Quellenhinweis.
- Streamschlüssel und Secrets werden maskiert angezeigt und dürfen nicht geloggt werden.

## Linux-Hinweise

Für OBS-Autostart sind eine aktive X11- oder Wayland-Sitzung, `XDG_RUNTIME_DIR`, Zugriff auf PipeWire/PulseAudio, GPU-Treiber und deaktivierter Ruhezustand erforderlich. Systemweite Dienste besitzen typischerweise keinen Zugriff auf die grafische Sitzung; der Desktop-Agent läuft deshalb als User Service.
