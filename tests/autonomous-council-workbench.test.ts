import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('SENDEGOTT council workbench', () => {
  it('stores immutable revisions, CEO approvals, conversations and deliverables', async () => {
    const [migration, database] = await Promise.all([
      readFile('packages/database/src/052_autonomous_council_workbench.sql', 'utf8'),
      readFile('packages/database/src/autonomous-studio.ts', 'utf8'),
    ]);
    expect(migration).toContain("'awaiting_ceo'");
    expect(migration).toContain('autonomous_studio_council_messages');
    expect(migration).toContain('autonomous_studio_deliverables');
    expect(migration).toContain('superseded_by_decision_id');
    expect(database).toContain('spawnAutonomousDecisionRevision');
    expect(database).toContain('reviewAutonomousDecisionByCeo');
  });

  it('turns approved format decisions into editable overlays and a refreshed 24-hour schedule', async () => {
    const worker = await readFile('apps/worker/src/autonomous-studio.ts', 'utf8');
    expect(worker).toContain('createDedicatedFormatOverlay');
    expect(worker).toContain('createOverlayProject');
    expect(worker).toContain('publishOverlayVersion');
    expect(worker).toContain('autopilotOnce(log)');
    expect(worker).toContain('minimumFormatBlueprints');
  });

  it('provides council chat, concrete plans, PDF handouts and explicit CEO actions', async () => {
    const [page, routes, deliverables] = await Promise.all([
      readFile('apps/web/src/pages/SendegottPage.tsx', 'utf8'),
      readFile('apps/api/src/autonomous-studio.ts', 'utf8'),
      readFile('apps/worker/src/autonomous-deliverables.ts', 'utf8'),
    ]);
    expect(page).toContain('Ratsgespräch');
    expect(page).toContain('Konkreter Lösungs- und Umsetzungsplan');
    expect(page).toContain('Genehmigt');
    expect(page).toContain('Nochmal überarbeiten');
    expect(page).toContain('Verwerfen');
    expect(routes).toContain("'/api/autonomous-studio/council/messages'");
    expect(routes).toContain("'/api/autonomous-studio/decisions/:id/ceo-review'");
    expect(deliverables).toContain('--print-to-pdf=');
  });
});
