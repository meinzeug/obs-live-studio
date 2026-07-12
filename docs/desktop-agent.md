# Desktop-Agent

Der Desktop-Agent läuft als eigener lokaler Prozess und bietet eine ausschließlich lokal gebundene HTTP-IPC-API. Die API-Anwendung kommuniziert über `DESKTOP_AGENT_URL` und `DESKTOP_AGENT_TOKEN`; sie importiert den Agent-Code nicht direkt.

## systemd User Service

```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/obs-live-studio-desktop-agent.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now obs-live-studio-desktop-agent.service
```

Wichtige Variablen: `OBS_EXECUTABLE`, `OBS_ARGS`, `OBS_STOP_TIMEOUT_MS`, `DESKTOP_AGENT_TOKEN`, `DESKTOP_AGENT_PORT`.
