import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('timecode-driven broadcast management', () => {
  it('keeps one active playlist per format slot and monitors schedule health', async () => {
    const [migration, database] = await Promise.all([
      readFile('packages/database/src/068_timecode_schedule_management.sql', 'utf8'),
      readFile('packages/database/src/index.ts', 'utf8'),
    ]);
    expect(migration).toContain('idx_autopilot_active_format_slot');
    expect(migration).toContain('broadcast_schedule_health');
    expect(database).toContain('updateBroadcastScheduleHealth');
    expect(database).toContain('getBroadcastScheduleHealth');
  });

  it('hands an overlong active show to the latest due timecode instead of replaying backlog', async () => {
    const [autopilot, api, page] = await Promise.all([
      readFile('apps/worker/src/autopilot.ts', 'utf8'),
      readFile('apps/api/src/index.ts', 'utf8'),
      readFile('apps/web/src/pages/BroadcastPage.tsx', 'utf8'),
    ]);
    expect(autopilot).toContain("order by scheduled_at desc,created_at desc");
    expect(autopilot).toContain('superseded-by-newer-timecode');
    expect(autopilot).toContain('requestBroadcastShowSwitch');
    expect(autopilot).toContain('autopilot_timecode_handoff');
    expect(api).toContain('scheduleHealth');
    expect(page).toContain('Zeitkanten-Monitor');
  });
});
