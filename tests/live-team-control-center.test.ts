import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { deriveTeamBroadcastState } from '../apps/web/src/components/LiveTeamControlCenter.js';

describe('live team control center', () => {
  it('distinguishes program authority from the physical stream output', () => {
    expect(deriveTeamBroadcastState(true, true)).toBe('live');
    expect(deriveTeamBroadcastState(true, false)).toBe('studio-only');
    expect(deriveTeamBroadcastState(false, true)).toBe('program-stream');
    expect(deriveTeamBroadcastState(false, false)).toBe('ready');
  });

  it('offers an explicit preview, take, program and controlled on-air workflow', async () => {
    const component = await readFile('apps/web/src/components/LiveTeamControlCenter.tsx', 'utf8');
    expect(component).toContain('LIVE GEHEN');
    expect(component).toContain('LIVE BEENDEN');
    expect(component).toContain('VORSCHAU');
    expect(component).toContain('PROGRAMM');
    expect(component).toContain('QUELLE ÜBERNEHMEN');
    expect(component).toContain('Quellen wählen und überblenden');
    expect(component).toContain('Audio-Notfalltaste');
    expect(component).toContain('<LiveProductionChat');
  });

  it('connects source selection to the animated server-side source workflow', async () => {
    const [page, api, database, migration] = await Promise.all([
      readFile('apps/web/src/pages/LivePage.tsx', 'utf8'),
      readFile('apps/api/src/index.ts', 'utf8'),
      readFile('packages/database/src/index.ts', 'utf8'),
      readFile('packages/database/src/079_live_studio_program_source_integrity.sql', 'utf8'),
    ]);
    expect(page).toContain('/api/live/sources/${encodeURIComponent(sourceId)}/add');
    expect(page).toContain('body: JSON.stringify({ hidden: !source.obs?.hidden })');
    expect(page).toContain('body: JSON.stringify({ preview: true })');
    expect(page).toContain('body: JSON.stringify({ sourceId, transition, durationMs })');
    expect(api).toContain('performLiveSourceTransition');
    expect(api).toContain('const kind = body.program');
    expect(api).toContain("body.hidden === true ? 'hide' : body.hidden === false ? 'show'");
    expect(database).toContain('where source_id<>$1 and in_program=true');
    expect(migration).toContain('idx_live_studio_single_program_source');
  });

  it('starts the stream output when the live takeover is confirmed', async () => {
    const page = await readFile('apps/web/src/pages/LivePage.tsx', 'utf8');
    expect(page).toContain("await api('/api/live/activate'");
    expect(page).toContain("await api('/api/live/stream/start'");
    expect(page).toContain('Live-Regie und Stream-Ausgabe sind live.');
  });
});
