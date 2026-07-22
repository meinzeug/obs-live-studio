import { execFile } from 'node:child_process';
import { access, mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  recordAutonomousStudioEvent,
  upsertAutonomousStudioDeliverable,
  type AutonomousStudioDecision,
} from '@ans/database/autonomous-studio';
import { upsertOperationalNotification } from '@ans/database/notifications';
import { PROJECT_ROOT } from './project-root.js';

const execFileAsync = promisify(execFile);

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function entries(value: unknown) {
  return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === 'object').map(object) : [];
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
        .map((entry) => entry.trim())
    : [];
}

function clean(value: unknown, fallback = '') {
  return String(value ?? fallback)
    .replace(/\s+/g, ' ')
    .trim();
}

function html(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function handoutSections(decision: AutonomousStudioDecision) {
  const proposal = object(decision.proposal);
  const configured = object(proposal.handout);
  const configuredSections = entries(configured.sections)
    .map((section) => ({ heading: clean(section.heading), bullets: strings(section.bullets) }))
    .filter((section) => section.heading && section.bullets.length);
  if (configuredSections.length) return configuredSections;
  const sections: Array<{ heading: string; bullets: string[] }> = [];
  const solutions = entries(proposal.solutionPlan).map(
    (solution) =>
      `${clean(solution.problem)} — ${clean(solution.solution)} (Verantwortlich: ${clean(solution.owner, 'Redaktion')})`,
  );
  if (solutions.length) sections.push({ heading: 'Probleme und beschlossene Lösungen', bullets: solutions });
  const formats = entries(proposal.formatBlueprints).map(
    (format) =>
      `${clean(format.name)}: ${clean(format.description)} · ${clean(format.contentMode)} · ${clean(format.durationMinutes)} Minuten`,
  );
  if (formats.length) sections.push({ heading: 'Neue Sendeformate', bullets: formats });
  const execution = entries(proposal.executionPlan).map(
    (step) => `${clean(step.step)}. ${clean(step.action)} — Ergebnis: ${clean(step.output)} · ${clean(step.owner)}`,
  );
  if (execution.length) sections.push({ heading: 'Umsetzungsplan', bullets: execution });
  const metrics = strings(proposal.successMetrics);
  if (metrics.length) sections.push({ heading: 'Messbare Abnahme', bullets: metrics });
  return sections.length
    ? sections
    : [
        { heading: 'Auftrag', bullets: [decision.instruction] },
        {
          heading: 'Beschlussentwurf',
          bullets: [clean(proposal.interpretation ?? proposal.executiveSummary, 'Die Ratsvorlage wird konkretisiert.')],
        },
      ];
}

function solutionMarkdown(decision: AutonomousStudioDecision) {
  const proposal = object(decision.proposal);
  const lines = [
    `# ${decision.title}`,
    '',
    clean(proposal.interpretation ?? proposal.executiveSummary, decision.instruction),
    '',
    `Revision: ${decision.revision_number} · Status: ${decision.status}`,
  ];
  for (const section of handoutSections(decision)) {
    lines.push('', `## ${section.heading}`, '', ...section.bullets.map((bullet) => `- ${bullet}`));
  }
  const restrictions = strings(proposal.restrictions ?? proposal.riskControls);
  if (restrictions.length) lines.push('', '## Leitplanken', '', ...restrictions.map((item) => `- ${item}`));
  return lines.join('\n');
}

async function chromeExecutable() {
  const candidates = [
    process.env.CHROME_EXECUTABLE,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Nächsten lokal installierten Browser versuchen.
    }
  }
  throw new Error('Für das PDF-Handout wurde kein lokaler Chrome-/Chromium-Renderer gefunden.');
}

async function renderHandoutPdf(decision: AutonomousStudioDecision, markdown: string) {
  const directory = resolve(PROJECT_ROOT, 'var/media/autonomous-studio/handouts');
  await mkdir(directory, { recursive: true, mode: 0o750 });
  const base = `${decision.id}-r${decision.revision_number}`;
  const htmlPath = resolve(directory, `${base}.html`);
  const pdfPath = resolve(directory, `${base}.pdf`);
  const proposal = object(decision.proposal);
  const configured = object(proposal.handout);
  const sections = handoutSections(decision);
  const document = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
    @page{size:A4;margin:18mm}*{box-sizing:border-box}body{margin:0;color:#12202d;font:12px/1.55 Arial,sans-serif}
    header{padding:18px 20px;border-radius:12px;background:#07131f;color:#fff;border-left:7px solid #2dd4bf}
    header small{color:#67e8f9;text-transform:uppercase;letter-spacing:.12em}h1{margin:5px 0 7px;font-size:25px}
    header p{margin:0;color:#cbd5e1}.meta{display:flex;gap:18px;margin:12px 0;color:#526170;font-size:10px}
    section{break-inside:avoid;margin:16px 0;padding:13px 15px;border:1px solid #dbe4eb;border-radius:10px}
    h2{margin:0 0 8px;color:#0f766e;font-size:16px}ul{margin:0;padding-left:20px}li{margin:5px 0}
    footer{margin-top:18px;padding-top:8px;border-top:1px solid #dbe4eb;color:#64748b;font-size:9px}
  </style></head><body><header><small>Open TV Studio · KI-Sendergremium</small><h1>${html(
    clean(configured.title, decision.title),
  )}</h1><p>${html(clean(configured.summary ?? proposal.interpretation ?? proposal.executiveSummary, decision.instruction))}</p></header>
  <div class="meta"><span>Vorgang ${html(decision.id)}</span><span>Revision ${decision.revision_number}</span><span>${html(
    new Date().toLocaleString('de-DE'),
  )}</span></div>${sections
    .map(
      (section) =>
        `<section><h2>${html(section.heading)}</h2><ul>${section.bullets
          .map((bullet) => `<li>${html(bullet)}</li>`)
          .join('')}</ul></section>`,
    )
    .join(
      '',
    )}<footer>Automatisch erstelltes Arbeitshandout. Umsetzung erst nach Gremiumsquorum, zwei unabhängigen KI-Prüfungen und – sofern erforderlich – CEO-Freigabe.</footer>
  <script type="application/json" id="source-markdown">${html(markdown)}</script></body></html>`;
  await writeFile(htmlPath, document, { mode: 0o640 });
  const chrome = await chromeExecutable();
  await execFileAsync(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-pdf-header-footer',
      `--print-to-pdf=${pdfPath}`,
      `file://${htmlPath}`,
    ],
    { timeout: 90_000, maxBuffer: 2 * 1024 * 1024 },
  );
  const info = await stat(pdfPath);
  if (info.size < 500) throw new Error('Der PDF-Renderer hat keine vollständige Datei erzeugt.');
  return { path: pdfPath, size: info.size };
}

export async function createAutonomousDecisionDeliverables(decision: AutonomousStudioDecision) {
  const proposal = object(decision.proposal);
  const markdown = solutionMarkdown(decision);
  await upsertAutonomousStudioDeliverable({
    decisionId: decision.id,
    kind: 'solution-brief',
    title: 'Lösungs- und Umsetzungsplan',
    content: proposal,
    markdown,
  });
  for (const format of entries(proposal.formatBlueprints)) {
    const name = clean(format.name, 'Neues Sendeformat');
    await upsertAutonomousStudioDeliverable({
      decisionId: decision.id,
      kind: 'format-blueprint',
      title: `Formatentwurf · ${name}`.slice(0, 240),
      content: format,
      markdown: `# ${name}\n\n${clean(format.description)}\n\n## Overlay\n${clean(format.overlayBrief)}\n\n## Interaktion\n${clean(format.audienceInteraction)}`,
    });
  }
  const handoutTitle = 'PDF-Handout für die Senderleitung';
  await upsertAutonomousStudioDeliverable({
    decisionId: decision.id,
    kind: 'handout',
    title: handoutTitle,
    status: 'preparing',
    content: object(proposal.handout),
    markdown,
  });
  try {
    const pdf = await renderHandoutPdf(decision, markdown);
    await upsertAutonomousStudioDeliverable({
      decisionId: decision.id,
      kind: 'handout',
      title: handoutTitle,
      content: object(proposal.handout),
      markdown,
      filePath: pdf.path,
      mimeType: 'application/pdf',
      sizeBytes: pdf.size,
    });
    await recordAutonomousStudioEvent({
      decisionId: decision.id,
      eventType: 'deliverables_ready',
      title: 'Lösungsplan und PDF-Handout erstellt',
      metadata: { formatBlueprints: entries(proposal.formatBlueprints).length, pdfBytes: pdf.size },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await upsertAutonomousStudioDeliverable({
      decisionId: decision.id,
      kind: 'handout',
      title: handoutTitle,
      status: 'failed',
      content: object(proposal.handout),
      markdown,
      error: message.slice(0, 1600),
    });
    await upsertOperationalNotification({
      level: 'warning',
      component: 'autonomous-studio',
      dedupeKey: `autonomous-studio:handout:${decision.id}`,
      message: `Das PDF-Handout für „${decision.title}“ konnte nicht gerendert werden; der vollständige Lösungsplan bleibt in der WebUI verfügbar.`,
      details: { decisionId: decision.id, error: message },
    }).catch(() => null);
  }
}
