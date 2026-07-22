import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('autopilot advisory-lock isolation', () => {
  it('scopes the singleton lock to database and schema so isolated tests cannot collide with production', async () => {
    const worker = await readFile('apps/worker/src/autopilot.ts', 'utf8');
    expect(worker).toContain("current_database()||':'||current_schema()||':autopilot'");
    expect(worker).toContain('pg_try_advisory_lock');
    expect(worker).toContain('pg_advisory_unlock');
    expect(worker).not.toContain('AUTOPILOT_LOCK_KEY');
  });
});
