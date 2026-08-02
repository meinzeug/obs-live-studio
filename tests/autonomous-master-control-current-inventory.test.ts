import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('autonomous master control current inventory', () => {
  it('measures only same-day, fully preproduced Codex inventory', async () => {
    const source = await readFile('apps/worker/src/autonomous-operations.ts', 'utf8');
    expect(source).toContain('current_strict_ready_videos');
    expect(source).toContain('youtube_preproduced_script_is_broadcast_ready(package.id)');
    expect(source).toContain("package.production_model like 'codex-cli%'");
    expect(source).toContain("time zone 'Europe/Berlin'");
    expect(source).toContain("'ai-roundtable'");
    expect(source).toContain('editorial-admission-failed-on-air');
    expect(source).toContain("command: 'stop'");
    expect(source).toContain('last_action_fingerprint');
    expect(source).toContain("state.last_action?.startsWith('skip-stalled-item:')");
    expect(source).toContain('watchdogRecoveryOperationId(state.last_action)');
    expect(source).toContain('getBroadcastRecoveryOperation');
    expect(source).toContain('master_control_playout_recovery_retry_allowed');
  });

  it('reports repaired only after all detected findings are gone', async () => {
    const source = await readFile('apps/worker/src/autonomous-operations.ts', 'utf8');
    expect(source).toContain('remaining.length === 0');
    expect(source).toContain("status: result ? 'completed' : 'skipped'");
  });
});
