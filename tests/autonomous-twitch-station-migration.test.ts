import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('autonomous Twitch station production contract', () => {
  it('requires a real rolling day and quarantines rejected Codex plans', async () => {
    const migration = await readFile('packages/database/src/097_autonomous_twitch_station.sql', 'utf8');
    expect(migration).toContain("'blocked'");
    expect(migration).toContain('last_action_fingerprint');
    expect(migration).toContain('minimum_upcoming_shows=greatest(minimum_upcoming_shows,24)');
    expect(migration).toContain('minimum_schedule_minutes=greatest(minimum_schedule_minutes,1440)');
    expect(migration).toContain("'local-station-signal-current-day-ticker'");
    expect(migration).toContain('question_interval_seconds=least(question_interval_seconds,90)');
    expect(migration).toContain('chat_platforms @> \'["twitch"]\'::jsonb');
    expect(migration).toContain('blocked-codex-editorial-admission');
    expect(migration).toContain("status in ('planning','ready','active','superseded')");
    expect(migration).not.toContain("status='interrupted'\nwhere playlist.status in");
  });
});
