import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('timecode-driven broadcast management', () => {
  it('keeps one active playlist per real time slot and monitors schedule health', async () => {
    const [migration, lifecycleMigration, database, worker, api] = await Promise.all([
      readFile('packages/database/src/068_timecode_schedule_management.sql', 'utf8'),
      readFile('packages/database/src/090_broadcast_playlist_lifecycle.sql', 'utf8'),
      readFile('packages/database/src/index.ts', 'utf8'),
      readFile('apps/worker/src/autopilot.ts', 'utf8'),
      readFile('apps/api/src/index.ts', 'utf8'),
    ]);
    expect(migration).toContain('idx_autopilot_active_format_slot');
    expect(lifecycleMigration).toContain('partition by scheduled_at');
    expect(lifecycleMigration).toContain('idx_autopilot_active_time_slot');
    expect(lifecycleMigration).toContain('drop index if exists idx_autopilot_active_format_slot');
    expect(migration).toContain('broadcast_schedule_health');
    expect(database).toContain('createAutopilotBroadcastPlaylist');
    expect(database).toContain('updateBroadcastScheduleHealth');
    expect(database).toContain('getBroadcastScheduleHealth');
    expect(worker).toContain('createAutopilotBroadcastPlaylist');
    expect(worker).toContain('context-preparation-deferred-for-continuous-playout');
    expect(worker).toContain('index === 0');
    expect(api).toContain('createAutopilotBroadcastPlaylist');
  });

  it('hands an overlong active show to the latest due timecode instead of replaying backlog', async () => {
    const [autopilot, api, page] = await Promise.all([
      readFile('apps/worker/src/autopilot.ts', 'utf8'),
      readFile('apps/api/src/index.ts', 'utf8'),
      readFile('apps/web/src/pages/BroadcastPage.tsx', 'utf8'),
    ]);
    expect(autopilot).toContain('order by scheduled_at desc,created_at desc');
    expect(autopilot).toContain('superseded-by-newer-timecode');
    expect(autopilot).toContain('requestBroadcastShowSwitch');
    expect(autopilot).toContain('autopilot_timecode_handoff');
    expect(api).toContain('scheduleHealth');
    expect(page).toContain('<OnAirBar status={operations} active="planning"');
  });
});
