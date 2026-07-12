# Architektur

Das System ist als npm-Workspace-Monorepo aufgebaut. Fastify stellt API, Sicherheitsheader, Rate-Limits und Overlay-Fallback bereit. React/Vite bildet das Control-Center. PostgreSQL speichert normalisierte Tabellen für Benutzer, Rollen, Quellen, Artikel, Overlays, Szenen, OBS, Sendelisten, Logs, Healthchecks und Backups. Worker und Desktop-Agent sind getrennte Prozesse für 24/7-Betrieb und grafische OBS-Steuerung.
