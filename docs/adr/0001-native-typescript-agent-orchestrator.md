# ADR 0001: Nativer TypeScript-Agent-Orchestrator

- Status: angenommen
- Datum: 22. Juli 2026
- Entscheider: technische Phase-0-Analyse; produktive Erweiterungen bleiben CEO-pflichtig

## Kontext

Open TV Studio ist ein strikt typisiertes npm-Workspace-Monorepo. Fastify, Worker, PostgreSQL-Zustände, OpenRouter-
Budgetierung, Broadcast-Runner und ObsController bilden bereits einen transaktionalen Kontrollpfad. Das neue
Multi-Agent-System muss diese Invarianten erweitern und darf keinen zweiten, schwächer kontrollierten Control-Plane
einführen.

Geprüft wurden CrewAI, AutoGen und eine kleine Eigenentwicklung. Grundlage waren die offiziellen Unterlagen am
22. Juli 2026:

- [CrewAI-Dokumentation](https://docs.crewai.com/) beschreibt Agents, Flows, Pydantic-Ausgaben und Installation über
  `uv`, also einen separaten Python-Stack.
- [Microsoft AutoGen](https://github.com/microsoft/autogen) befindet sich offiziell im Maintenance Mode, empfiehlt für
  neue Projekte den Microsoft Agent Framework-Nachfolger und nennt Python/.NET als Kernlaufzeiten.
- Die [AutoGen-Installationsdokumentation](https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/installation.html)
  verlangt Python und empfiehlt für Codeausführung eine eigene Docker-Isolation.

## Entscheidung

`packages/agent-orchestrator` wird als framework-neutrales TypeScript-Package im bestehenden Workspace entwickelt.
Es implementiert nur Domänenlogik:

- streng typisierte Rollen, Ereignisse, Zustände und Workflowdefinitionen;
- Capability- und Budgetprüfung;
- deterministische Übergänge und Abbruchsignale;
- Adapterinterfaces für Modell, Memory, Tools, Audit und Uhr;
- keine direkte Netzwerk-, Shell-, Git-, OBS- oder Datenbankausführung im Kern.

PostgreSQL bleibt die persistente Quelle der Wahrheit. `packages/ai-provider` bleibt der einzige Modellzugang. Externe
Frameworks dürfen später nur als unprivilegierte Adapter hinter denselben Capability- und Auditgrenzen erprobt werden.

## Bewertungsmatrix

| Kriterium | CrewAI | AutoGen | Nativer TS-Kern |
| --- | --- | --- | --- |
| gleiche Laufzeit/Toolchain | zusätzlicher Python-Dienst | zusätzlicher Python/.NET-Dienst | ja |
| bestehender OpenRouter-Budgetadapter | Brücke nötig | Brücke nötig | direkt |
| PostgreSQL als autoritativer Zustand | eigene Integration | eigene Integration | direkt |
| vorhandene Zod-/TS-Domänentypen | doppelte Modelle | doppelte Modelle | direkt |
| harte Capability-Policy vor jedem Tool | anpassbar, aber fremde Runtime | anpassbar, aber fremde Runtime | Kernanforderung |
| Betriebsrisiko | zweiter Dependency-/Service-Stack | Maintenance Mode plus zweiter Stack | kleinster neuer TCB |
| schnelle Agentenprototypen | sehr gut | gut | bewusst konservativer |

## Folgen

Positiv:

- ein Zustandsmodell, ein Build, ein Auditpfad und ein Budgetmechanismus;
- bestehende DB-Constraints bleiben letzte Instanz;
- Orchestrator kann ohne Modell oder Netzwerk vollständig getestet werden;
- Frameworkwechsel beeinflusst später nicht die Sicherheitsgrenze.

Negativ:

- Gruppenchat-, Memory- und Evaluationsprimitive müssen domänenspezifisch implementiert werden;
- weniger fertige Beispiele als in Agentenframeworks;
- mehr Verantwortung für Telemetrie, Retry und Workflowversionierung.

## Verwerfungs- und Revisionskriterien

Die Entscheidung wird erneut geprüft, wenn ein Framework alle folgenden Punkte nachweislich erfüllt:

1. offiziell unterstützte TypeScript-Laufzeit ohne separaten privilegierten Dienst;
2. externe, deterministische PostgreSQL-Zustandsführung;
3. vor jedem Toolaufruf synchron erzwingbare Capability-/Budgetentscheidung;
4. vollständige Offline-Tests und lokaler Provideradapter;
5. keine Schwächung von Quorum, CEO-Freigabe, Audit oder Rollback.
