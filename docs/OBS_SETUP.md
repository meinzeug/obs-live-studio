# OBS_SETUP

Diese Dokumentation beschreibt den Stand des lauffähigen Grundsystems und die produktionsrelevanten Regeln.

## Kernpunkte

- Alle Bedienoberflächen sind deutschsprachig geplant und im Grundsystem unter `apps/web` angelegt.
- OBS wird ausschließlich über ein eigenes Profil und eine eigene Szenensammlung genutzt: **Automated News Studio**.
- Direkte OBS-Dateiänderungen dürfen nur bei beendetem OBS und nach Backup erfolgen; im Betrieb wird OBS WebSocket verwendet.
- Quellenabrufe respektieren SSRF-Schutz, robots-/Nutzungsgrenzen und umgehen keine Paywalls, Logins oder Captchas.
- Fremde Artikel werden nicht vollständig neu veröffentlicht; das System erzeugt neutrale Zusammenfassungen mit Quellenhinweis.
- Streamschlüssel und Secrets werden maskiert angezeigt und dürfen nicht geloggt werden.

## Linux-Hinweise

Für OBS-Autostart sind eine aktive X11- oder Wayland-Sitzung, `XDG_RUNTIME_DIR`, Zugriff auf PipeWire/PulseAudio, GPU-Treiber und deaktivierter Ruhezustand erforderlich. Systemweite Dienste besitzen typischerweise keinen Zugriff auf die grafische Sitzung; der Desktop-Agent läuft deshalb als User Service. `OBS_BROWSER_HW_ACCEL=false` ist der stabile Standard für Hosts mit Software-Rendering und kann auf einem geprüften GPU-System gezielt aktiviert werden.

## YouTube-Konto wechseln

Ein Kanalwechsel setzt die alte OBS-Anmeldung und den alten Streamschlüssel bewusst zurück. OBS muss dabei beendet sein:

```bash
systemctl --user stop obs-live-studio-desktop-agent.service
npm run obs:reset-youtube
systemctl --user start obs-live-studio-desktop-agent.service
```

Danach in OBS unter **Einstellungen > Stream** entweder das neue YouTube-Konto verbinden oder den Streamschlüssel aus YouTube Studio eintragen. Erst nach einem erfolgreichen manuellen Test darf `STREAM_AUTO_START=true` gesetzt und die API neu gestartet werden. Das Reset-Script legt vor jeder Änderung ein lokales Backup unter `var/backups/` an.

Ein anderer Kanal darf nicht verwendet werden, um eine von YouTube verhängte Livestream- oder Kontosperre zu umgehen. Vor der Verbindung muss YouTube Studio den Zielkanal ausdrücklich für Encoder-Livestreams freigeben.
