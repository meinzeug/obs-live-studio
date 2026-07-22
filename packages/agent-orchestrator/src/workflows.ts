import { assertAgentCapability } from './capabilities.js';
import type { InstantiatedWorkflow, WorkflowTemplate } from './types.js';

export const WORKFLOW_TEMPLATES: Record<string, WorkflowTemplate> = {
  'self-improvement-review': {
    key: 'self-improvement-review',
    version: 1,
    title: 'Software-Verbesserung prüfen',
    description: 'Erzeugt einen reinen Code- und Testvorschlag und übergibt ihn anschließend an das Gremium.',
    riskTier: 'high',
    steps: [
      {
        key: 'inspect-repository',
        title: 'Repository und Betriebsdaten prüfen',
        agentId: 'self-improvement-engineer',
        capability: 'read:repository-index',
        purpose: 'Relevante Komponenten und überprüfbare Fehlersignale bestimmen.',
      },
      {
        key: 'draft-change',
        title: 'Änderungsvorschlag ausarbeiten',
        agentId: 'self-improvement-engineer',
        capability: 'propose:code-change',
        dependsOn: ['inspect-repository'],
        purpose: 'Patchplan, Tests, Risiken und Rückrollweg formulieren; keine Ausführung.',
      },
      {
        key: 'impact-review',
        title: 'Senderwirkung bewerten',
        agentId: 'growth-analytics',
        capability: 'propose:strategy',
        dependsOn: ['draft-change'],
        purpose: 'Nutzen und mögliche negative Auswirkungen auf Programm und Publikum prüfen.',
      },
      {
        key: 'council-handoff',
        title: 'Sichere Gremiumsübergabe vorbereiten',
        agentId: 'self-improvement-engineer',
        capability: 'handoff:council',
        dependsOn: ['impact-review'],
        purpose: 'Unveränderliches Übergabepaket für Quorum, Doppelprüfung und CEO erstellen.',
      },
    ],
  },
  'growth-cycle': {
    key: 'growth-cycle',
    version: 1,
    title: 'Programmleistung auswerten',
    description: 'Leitet aus realen Messwerten eine überprüfbare, redaktionell vertretbare Strategie ab.',
    riskTier: 'medium',
    steps: [
      {
        key: 'measure',
        title: 'Messwerte und Verlauf auswerten',
        agentId: 'growth-analytics',
        capability: 'read:studio-metrics',
        purpose: 'Ist-Zustand, Datenlücken und belastbare Trends trennen.',
      },
      {
        key: 'strategy',
        title: 'Wachstumshypothese entwickeln',
        agentId: 'growth-analytics',
        capability: 'propose:strategy',
        dependsOn: ['measure'],
        purpose: 'Messbare, nicht manipulative Strategie mit Abbruchkriterien vorschlagen.',
      },
      {
        key: 'content-impact',
        title: 'Programmkonzept ergänzen',
        agentId: 'dynamic-content-producer',
        capability: 'propose:content',
        dependsOn: ['strategy'],
        purpose: 'Konkrete, vorhandene Produktionsmittel nutzende Formate skizzieren.',
      },
      {
        key: 'council-handoff',
        title: 'Gremiumsübergabe vorbereiten',
        agentId: 'growth-analytics',
        capability: 'handoff:council',
        dependsOn: ['content-impact'],
        purpose: 'Belege, Hypothesen, Grenzen und Vorschläge für das bestehende Freigabesystem bündeln.',
      },
    ],
  },
  'format-lab': {
    key: 'format-lab',
    version: 1,
    title: 'Neues Sendeformat entwickeln',
    description: 'Entwickelt aus Senderbestand, Publikumssignalen und Leitlinien einen Formatentwurf.',
    riskTier: 'medium',
    steps: [
      {
        key: 'history',
        title: 'Programm- und Publikumshistorie prüfen',
        agentId: 'growth-analytics',
        capability: 'read:channel-history',
        purpose: 'Wiederholungen, Lücken und tatsächliche Interessen bestimmen.',
      },
      {
        key: 'format',
        title: 'Format und Pilotfolge entwerfen',
        agentId: 'dynamic-content-producer',
        capability: 'propose:content',
        dependsOn: ['history'],
        purpose: 'Layout, Dramaturgie, Quellen-, Rechte- und Produktionsbedarf ausarbeiten.',
      },
      {
        key: 'success-plan',
        title: 'Erfolg und Risiken messbar machen',
        agentId: 'growth-analytics',
        capability: 'propose:strategy',
        dependsOn: ['format'],
        purpose: 'Messgrößen, Stop-Kriterien und Testzeitraum bestimmen.',
      },
      {
        key: 'council-handoff',
        title: 'Gremiumsübergabe vorbereiten',
        agentId: 'dynamic-content-producer',
        capability: 'handoff:council',
        dependsOn: ['success-plan'],
        purpose: 'Den unveränderten Entwurf an Quorum und Doppelprüfung übergeben.',
      },
    ],
  },
  'clip-strategy': {
    key: 'clip-strategy',
    version: 1,
    title: 'Highlight- und Clip-Strategie',
    description: 'Identifiziert ausschließlich Clip-Kandidaten; rendert oder veröffentlicht in Phase 1 nicht.',
    riskTier: 'medium',
    steps: [
      {
        key: 'history',
        title: 'Sendungsverlauf prüfen',
        agentId: 'dynamic-content-producer',
        capability: 'read:channel-history',
        purpose: 'Qualifizierte, rechtegeklärte Kandidaten aus dem Verlauf bestimmen.',
      },
      {
        key: 'clips',
        title: 'Clip-Konzepte vorschlagen',
        agentId: 'dynamic-content-producer',
        capability: 'propose:content',
        dependsOn: ['history'],
        purpose: 'Schnittidee, Kontext, Quellen und Plattformvarianten entwerfen.',
      },
      {
        key: 'growth-check',
        title: 'Qualität und Nutzen prüfen',
        agentId: 'growth-analytics',
        capability: 'propose:strategy',
        dependsOn: ['clips'],
        purpose: 'Clickbait, Wiederholung und unbelegte Erfolgsaussagen herausfiltern.',
      },
      {
        key: 'council-handoff',
        title: 'Gremiumsübergabe vorbereiten',
        agentId: 'dynamic-content-producer',
        capability: 'handoff:council',
        dependsOn: ['growth-check'],
        purpose: 'Nur den geprüften Vorschlag an das bestehende Freigabesystem übergeben.',
      },
    ],
  },
};

export function validateWorkflowTemplate(template: WorkflowTemplate) {
  const keys = new Set<string>();
  for (const step of template.steps) {
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(step.key)) throw new Error(`Ungültiger Schritt: ${step.key}`);
    if (keys.has(step.key)) throw new Error(`Doppelter Schritt: ${step.key}`);
    assertAgentCapability(step.agentId, step.capability);
    for (const dependency of step.dependsOn ?? []) {
      if (!keys.has(dependency)) throw new Error(`Abhängigkeit ${dependency} muss vor ${step.key} stehen.`);
    }
    keys.add(step.key);
  }
  if (!template.steps.length || template.steps.length > 20) throw new Error('Workflow benötigt 1 bis 20 Schritte.');
  return template;
}

export function instantiateWorkflow(
  templateKey: string,
  input: { title?: string; goal: string; context?: Record<string, unknown> },
): InstantiatedWorkflow {
  const template = WORKFLOW_TEMPLATES[templateKey];
  if (!template) throw new Error(`Unbekannte Workflow-Vorlage: ${templateKey}`);
  validateWorkflowTemplate(template);
  const goal = input.goal.replace(/\s+/g, ' ').trim();
  if (goal.length < 3 || goal.length > 4000) throw new Error('Das Ziel muss zwischen 3 und 4000 Zeichen lang sein.');
  const title = (input.title || template.title).replace(/\s+/g, ' ').trim().slice(0, 180);
  return {
    templateKey: template.key,
    templateVersion: template.version,
    title,
    goal,
    riskTier: template.riskTier,
    input: { goal, context: input.context ?? {} },
    steps: template.steps.map((step, position) => ({ ...step, position })),
  };
}
