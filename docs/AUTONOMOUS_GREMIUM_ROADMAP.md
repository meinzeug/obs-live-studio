# Roadmap: autonomes SENDEGOTT-Sendergremium

Status: Phase 0, Phase 1 und autonomes 24/7 Master Control abgeschlossen; Phase 2 vorbereitet
Auftrag erfasst: 22. Juli 2026
Geltungsbereich: `meinzeug/obs-live-studio`

## Zielbild

SENDEGOTT wird zu einem kontrolliert autonomen Multi-Agent-System, das den 24-Stunden-Sender beobachtet, redaktionelle
und strategische Vorschläge erarbeitet, neue Formate und Inhalte produziert, Publikumsimpulse auswertet und die eigene
Software verbessert. Der Senderinhaber bleibt CEO und letzte Instanz für risikoreiche, kostenpflichtige, veröffentlichende
oder systemverändernde Maßnahmen.

Das System soll:

- den OBS-Livestream dynamisch steuern und optimieren;
- Sendungen, Formate, Overlays, Clips und redaktionelle Inhalte entwickeln;
- Chat-Signale in nachvollziehbare Vorschläge und geprüfte Maßnahmen überführen;
- die Codebasis analysieren, Verbesserungen in einer Sandbox testen und zunächst als Draft-PR bereitstellen;
- Entscheidungen, Kosten, Quellen, Resultate und Rücknahmen vollständig protokollieren;
- aus der Wirkung der letzten Entscheidungen lernen, ohne Sicherheits- oder Freigaberegeln selbst aufweichen zu können.

## Unverhandelbare Leitplanken

- Bestehendes Quorum, Publikumsrat und duale Prüfung durch zwei unabhängige Modelle bleiben erhalten.
- Kein Agent darf Quorum, Budgetgrenzen, Rollenrechte, Datenbank-Constraints, Authentifizierung oder redaktionelle
  Freigaben umgehen oder selbst abschwächen.
- Änderungen an Code, Infrastruktur, Secrets, Benutzerrechten, Ausspielzielen oder Kostenlimits benötigen eine explizite
  CEO-Freigabe. In der ersten Ausbaustufe werden ausschließlich Draft-PRs erzeugt; kein autonomer Merge und kein
  autonomes Deployment.
- Agenten arbeiten nach dem Prinzip geringster Rechte. Werkzeuge werden pro Rolle erlaubt, zeitlich begrenzt und
  revisionssicher protokolliert.
- Codeausführung findet in einer isolierten Sandbox ohne Produktions-Secrets, OBS-Produktionszugriff oder Schreibzugriff
  auf `main` statt.
- Jede externe Veröffentlichung besitzt Idempotenzschlüssel, tägliche Limits, Not-Aus, Vorschau und Rollback-Plan.
- Chat-Inhalte sind nicht vertrauenswürdig und dürfen niemals ungeprüft als Tool-, Shell-, SQL- oder Systemanweisung
  ausgeführt werden.
- Lokale Modelle und Offline-Fallbacks haben Vorrang, sofern Qualität und Sicherheitsprüfung ausreichen; OpenRouter wird
  ausschließlich innerhalb der hinterlegten Tages- und Anfragebudgets verwendet.

## Zielarchitektur

```text
Chat / Analytics / News / OBS / Mediathek
                  │
                  ▼
        Signal- und Ereignisbus
                  │
                  ▼
       packages/agent-orchestrator
        ├─ Rollen und Fähigkeiten
        ├─ Workflow-/Quorum-Engine
        ├─ Tool-Policy und Budgets
        ├─ Langzeit-Memory + RAG
        ├─ Evaluation und Audit
        └─ Sandbox-/Draft-PR-Gateway
                  │
        ┌─────────┼──────────┐
        ▼         ▼          ▼
   ai-provider  PostgreSQL  OBS-/Media-Controller
                  │
                  ▼
       CEO-Freigabe / kontrollierte Ausführung
```

Das neue Package bleibt Framework-neutral. CrewAI oder AutoGen dürfen nur nach einem technischen Spike übernommen
werden, wenn Betrieb, TypeScript-Integration, Lizenz, deterministische Zustandsführung und lokale Fallbacks besser sind
als eine schlanke eigene Orchestrierung. Die Datenbank ist die Quelle der Wahrheit; In-Memory-Dialogzustand allein ist
nicht zulässig.

## Arbeitsweise und Commit-Konvention

Jeder abgeschlossene, getestete Punkt wird hier mit `[x]`, Datum, Testnachweis und Commit-ID dokumentiert. Funktionale
Schritte erhalten getrennte, aussagekräftige Commits. Ein Punkt gilt erst als abgeschlossen, wenn Migrationen,
Typecheck, Lint, Unit-/Integrationstests und die jeweils relevanten Smoke-Tests erfolgreich sind.

## Phase 0 – Analyse und Sicherheitsbasis

- [x] Auftrag, Zielbild, Phasen und Sicherheitsgrenzen in dieser Roadmap gesichert. (22.07.2026)
- [x] Bestehende SENDEGOTT-, Publikumsrat-, AI-Team-, OpenRouter-, OBS-, Worker- und Freigabeflüsse als Sequenzdiagramme
      dokumentiert. (`docs/AUTONOMOUS_STUDIO_ARCHITECTURE.md`, 22.07.2026)
- [x] Bestehende Rollen, Rechte, Tabellen, Trigger, Budgetregeln, Modellprüfungen und Not-Aus-Pfade inventarisiert.
      (22.07.2026)
- [x] Threat Model für Prompt Injection, Datenabfluss, Tool Missuse, Supply Chain, Kostenexplosion und ungewollte
      Veröffentlichung ergänzt. (`docs/AUTONOMOUS_AGENT_THREAT_MODEL.md`, 22.07.2026)
- [x] Messbare Baseline für Entscheidungsdauer, Freigabequote, Kosten, Fehlerquote, Zuschauerinteraktion,
      Sendungsvielfalt und Rollback-Zeit erfasst. (`docs/baselines/AUTONOMOUS_STUDIO_2026-07-22.md`, 22.07.2026)
- [x] Architekturentscheidung für einen nativen TypeScript-Orchestrator gegenüber CrewAI/AutoGen getroffen.
      (`docs/adr/0001-native-typescript-agent-orchestrator.md`, 22.07.2026)

## Phase 1 – Agent-Orchestrierung

- [x] Neues Workspace-Package `packages/agent-orchestrator` mit strikt typisierten Rollen, Aufträgen,
      Werkzeugverträgen, Zuständen und globalem Abbruchsignal angelegt. (22.07.2026)
- [x] Orchestrator über eine strikt schema-validierte Aufgabe in `packages/ai-provider` integriert; Provider- und
      Modellwahl bleiben zentral budgetiert. (22.07.2026)
- [x] Rollen ergänzt:
  - [x] Self-Improvement Engineer „Nora“
  - [x] Growth & Analytics Agent „Leo“
  - [x] Dynamic Content Producer / Clip-Maker „Kian“
- [x] Fähigkeitssystem mit harter Rollen-Allowlist, Einmal-Token, Laufzeitlimit, Workflow-/Tageskostenlimit, Rate Limit
      und kryptografisch verkettetem append-only Tool-Audit gebaut. (22.07.2026)
- [x] Vier versionierte Workflows für Softwareprüfung, Wachstum, Formatentwicklung und Clip-Strategie implementiert.
      Jeder endet mit einer expliziten Übergabe an den vorhandenen Quorum-, Doppelprüfungs-, CEO-, Apply- und
      Rollback-Pfad. (22.07.2026)
- [x] Langzeit-Memory in PostgreSQL eingeführt. Da `pgvector` lokal nicht verfügbar ist, läuft der vollständig lokale,
      versionierte Volltext-Fallback `fts-simple-v1` ohne Cloud-Zwang. (22.07.2026)
- [x] RAG über Kanalhistorie, Gremiumsentscheidungen, Formate, Sendungsverlauf, Studiometriken, Leitlinien, freigegebene
      Dokumentation und vorherige Workflowschritte implementiert. (22.07.2026)
- [x] Memory-Retention, Maximalzahl, logische Löschung, Quellenbezug, Retrieval-Version und Datenschutz in UI und API
      steuerbar gemacht. (22.07.2026)
- [x] Orchestrator-Modus, drei Rollen, aktive Aufträge, Schritt-Abhängigkeiten, Kosten, Blockaden, Audit und Memory in
      SENDEGOTT visualisiert. (22.07.2026)
- [x] Unit-, PostgreSQL-, Concurrent-Claim-, Tagesbudget-, Not-Aus-, Preflight- und Prompt-Injection-Tests ergänzt.
      (22.07.2026)

## Phase 2 – Kontrollierte Selbstverbesserung

- [ ] Engineer-Agent kann das Repository ausschließlich lesend analysieren und begründete Verbesserungsvorschläge mit
      betroffenen Dateien, Risiko, Tests, Migration und Rollback erstellen.
- [ ] Reproduzierbare Sandbox für Patch-Erstellung und Tests bereitstellen (kein Host-Netz, keine Produktions-Secrets,
      CPU/RAM/Zeit/Dateigrößen-Limits).
- [ ] Zweistufiges Review implementieren: unabhängige technische KI-Prüfung plus bestehende Gremiums-/Sicherheitsprüfung.
- [ ] Git-Gateway mit kurzlebigen Branches, signierter Herkunftsmetadaten und Draft-PR-Erstellung integrieren.
- [ ] CEO-Workflow `Genehmigen`, `Überarbeiten`, `Verwerfen` mit Kommentar, Diff, Testbericht und Kosten anzeigen.
- [ ] Merge und Deployment in dieser Phase ausdrücklich manuell belassen; spätere Automatisierung erfordert einen neuen,
      explizit genehmigten Sicherheitsbeschluss.
- [ ] Automatische Konflikt-, Migrations-, Secret-, Lizenz- und Dependency-Prüfung einbauen.
- [ ] Rollback-Paket und Wiederherstellungsprobe für jede freigegebene Änderung erzeugen.

## 24/7 Master Control – autonomer Realbetrieb

Die Betriebsarchitektur folgt vier nachprüfbaren Mustern professioneller Sender: integrierte Planung und
Redaktionskoordination, Sammeln/Prüfen/Produzieren/Verteilen, Schedule-to-Playout-Automation sowie permanentes
Monitoring und Quality Control. Als Primärquellen dienten die
[EBU Newsroom Workflows](https://tech.ebu.ch/news/2021/02/new-task-group-on-newsroom-related-workflows), das
[integrierte SWR-Newsroom-Modell](https://www.ebu.ch/news/2013/03/imps-heads-to-swrs-new-tri-media), die
[EBU MediaLab Produktionskette](https://tech.ebu.ch/fr/events/2026/cloud-workflows-medialab),
[EBU TECH 3316](https://tech.ebu.ch/docs/tech/tech3316.pdf?t=) für Monitoring/QC und
[SMPTE BXF](https://pub.smpte.org/latest/rp2021-5/rp2021-5-2013.pdf) für die Übergabe vom Sendeplan an die
Playout-Automation.

- [x] Persistenten Master-Control-Zyklus mit Advisory Lock, Zeitplan, Snapshot, Findings, Aktionen und Verifikation
      eingeführt. (22.07.2026)
- [x] OBS-Erreichbarkeit, Streamzustand, Runner-Lease, On-Air-Zustand, Programmdeckung, Wiederholungsquote,
      Quellenzustand, Formatbestand und Content-Verfügbarkeit fortlaufend prüfen. (22.07.2026)
- [x] Bekannte reversible Betriebsfehler ohne Rückfrage beheben: Autopilot aktivieren, Stream starten,
      Runner-Recovery beauftragen, Quellen mit Backoff neu einplanen und bei fehlenden Medien auf sendefähige Inhalte
      ausweichen. (22.07.2026)
- [x] Ein tägliches 24-Stunden-Kontinuitätsraster real in die Autopilot-Konfiguration schreiben und den Sendeplan
      anschließend über den vorhandenen Autopilot materialisieren. (22.07.2026)
- [x] Fehlende Formate und Eigenproduktionen selbstständig als normale Gremiumsentscheidungen anlegen. Quorum und zwei
      unabhängige Reviews bleiben Pflicht; nach Zustimmung ist keine CEO-Rückfrage erforderlich. (22.07.2026)
- [x] Genehmigte Formatideen als echte `broadcast_templates`, veröffentlichte Overlay-Projekte und wiederkehrende
      Autopilot-Slots anlegen. (22.07.2026)
- [x] Genehmigte Eigenproduktionen als befüllte `broadcast_playlists` im 24-Stunden-Plan materialisieren und den Erfolg
      anhand realer Rundown-Items verifizieren. (22.07.2026)
- [x] Gremiumsblocker bei Formaten und Produktionen als neue, eigenständig geplante Revision erneut durch Quorum und
      Doppelprüfung führen; ausgeschöpfte Revisionsketten sauber beenden, damit Ersatzlösungen entstehen können.
      (22.07.2026)
- [x] Technisch unterbrochene Beratungen mit gestaffeltem, begrenztem Retry automatisch fortsetzen und bei ungültigen
      OpenRouter-Strukturantworten einen lokalen, ausführbaren Plan erzeugen. Ein ausgeschöpfter Revisionsentwurf wird
      nicht fälschlich freigegeben, sondern durch einen neuen, erneut vollständig geprüften Lösungsweg ersetzt.
      Ersetzte Revisionen und zusammengeführte Doppelarbeit werden in der WebUI nicht länger als verlorener Beschluss
      dargestellt. (22.07.2026)
- [x] Vorabprüfung und Umsetzung entkoppeln: Das Gremium prüft Materialisierungs-, Rechte-, Budget-, Fallback- und
      Abnahmeregeln; nach Freigabe muss der Worker Format, veröffentlichtes Overlay, Autopilot-Slot beziehungsweise eine
      befüllte Playlist real nachweisen, bevor der Beschluss den Status `Aktiv` erhält. (22.07.2026)
- [x] Master-Control-Lage, konkrete Reparaturen und laufende kreative Arbeit im SENDEGOTT sichtbar und konfigurierbar
      machen. (22.07.2026)

## Phase 3 – Livestream- und Content-Autonomie

- [ ] Gremiumsentscheidungen in idempotente, zeitlich begrenzte OBS-Aktionspläne übersetzen; UI spricht weiterhin nur
      den bestehenden `ObsController` an.
- [ ] Regeln für dynamische Szenen, Preview/Program, Audio-Ducking, Einspieler, Breaking News und Rückkehr zum Autopilot
      mit sicherem Ausgangszustand implementieren.
- [ ] Chat-Aktivität, Themen, Sentiment und Moderationssignale als aggregierte, gegen Prompt Injection gehärtete Events
      bereitstellen.
- [x] Content Producer erstellt geprüfte Formatentwürfe und materialisiert Format, Overlay, Sendeplatz und befüllte
      Ausstrahlung real. Produktive Kreativänderungen bleiben durch Quorum und Doppelprüfung abgesichert. (22.07.2026)
- [ ] Automatische Highlight-/Clip-Erkennung aus dem 24h-Stream mit Rechte-, Quellen- und Duplikatprüfung ergänzen.
- [ ] Freigegebene Clips über bestehende YouTube-Shorts-/TikTok-Warteschlangen publizieren; Tageslimits und Mindestabstand
      bleiben verbindlich.
- [ ] Zuschauerideen mit Herkunft, Zustimmung, Gegenargumenten, Gremiumsentscheidung und Umsetzung sichtbar machen.
- [ ] Notfallpfad testen: Agenten stoppen, laufende Aktion abbrechen, OBS auf sichere Szene schalten, Autopilot fortsetzen.

## Phase 4 – Monitoring, Evaluation und Optimierung

- [ ] Agenten-Metriken erfassen: Erfolgsquote, Latenz, Kosten, Wiederholungen, Quellenqualität, menschliche Korrekturen,
      Auswirkungen und Rollbacks.
- [ ] Zyklische Evaluation der letzten zehn Entscheidungen mit unabhängiger Gegenprüfung implementieren.
- [ ] Wirkung gegen die Phase-0-Baseline prüfen; Korrelation darf nicht automatisch als Kausalität ausgegeben werden.
- [ ] Modell-/Provider-Routing nach Qualität, Datenschutz, Latenz und Budget optimieren; lokale Fallbacks regelmäßig testen.
- [ ] Fehlverhalten, Drift und repetitive Vorschläge erkennen und betroffene Fähigkeiten automatisch pausieren.
- [ ] CEO-Dashboard mit Wirkung, Risiken, offenen Freigaben, Kosten, Agentengesundheit und Rücknahmeoptionen erweitern.
- [ ] Quartalsweise Wiederherstellungs-, Not-Aus-, Budget- und Rechteprüfung automatisieren.

## Querschnittsaufgaben

- [ ] `README.md`, `docs/ARCHITECTURE.md`, `docs/AUDIENCE_COUNCIL.md`, `docs/SECURITY.md`, API- und Betriebsdoku
      aktualisieren.
- [ ] Preflight um Orchestrator, Memory, Sandbox, Modellprovider, Budgets und Git-Gateway erweitern.
- [ ] Audit-Export für Entscheidungen, Quellen, Modellantworten, Tool-Aufrufe, Freigaben und Resultate ergänzen.
- [ ] Datenbankmigrationen vorwärts- und rückwärtskompatibel gestalten; alte Worker dürfen neue Aufträge nicht falsch
      beanspruchen.
- [ ] Alle neuen Dienste mit systemd/Docker-Healthcheck, Restart-Policy, Logrotation und Backup abdecken.
- [ ] E2E-Szenarien: Publikumsimpuls → Beratung → Dual Review → CEO-Freigabe → Vorschau → Ausführung → Wirkung → Rollback.
- [ ] Belastungstest für Ereignisspitzen im Chat und gleichzeitige Agentenaufträge durchführen.
- [ ] Dokumentierte lokale Betriebsart ohne externe KI sowie degradierte Betriebsart bei OpenRouter-Ausfall sicherstellen.

## Definition of Done

Die Roadmap ist vollständig umgesetzt, wenn das Gremium neue Inhalte und technische Verbesserungen nachvollziehbar
entwickeln kann, alle produktiven oder systemverändernden Aktionen die festgelegten Freigaben durchlaufen, Kosten und
Werkzeuge technisch begrenzt sind, die Software ohne Cloud-KI weiter sendefähig bleibt und jeder Schritt von Signal bis
Wirkung einschließlich Rollback auditierbar ist.

## Fortschrittsjournal

| Datum      | Phase | Ergebnis                                                                                          | Tests                                                                                          | Commit    |
| ---------- | ----- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------- |
| 22.07.2026 | 0     | Auftrag und kontrollierte Ausbauplanung gesichert                                                 | Dokumentprüfung                                                                                | `d5870d1` |
| 22.07.2026 | 0     | Ist-Flüsse, Threat Model, Baseline und ADR abgeschlossen                                          | Tests + DB-Leseprobe                                                                           | `9d48702` |
| 22.07.2026 | 1     | Drei Spezialagenten, Capability-Grants, Audit, Memory/RAG, SENDEGOTT-UI und Not-Aus implementiert | 544 Unit-Tests, 55 PostgreSQL-Integrationstests, Build, Audit, API-Preflight und Runtime-Smoke | `7062701` |
