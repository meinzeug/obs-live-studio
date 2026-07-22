# Architektur

Das System ist als npm-Workspace-Monorepo aufgebaut. Fastify stellt API, Sicherheitsheader, Rate-Limits und Overlay-Fallback bereit. React/Vite bildet das Control-Center. PostgreSQL speichert normalisierte Tabellen für Benutzer, Rollen, Quellen, Artikel, Overlays, Szenen, OBS, Sendelisten, Logs, Healthchecks und Backups. Worker und Desktop-Agent sind getrennte Prozesse für 24/7-Betrieb und grafische OBS-Steuerung.

Die vollständigen Zustands-, Freigabe- und Sendeflüsse des autonomen KI-Sendergremiums stehen in
[`AUTONOMOUS_STUDIO_ARCHITECTURE.md`](AUTONOMOUS_STUDIO_ARCHITECTURE.md). Die verbindliche Frameworkentscheidung ist
in [`adr/0001-native-typescript-agent-orchestrator.md`](adr/0001-native-typescript-agent-orchestrator.md) festgehalten.
