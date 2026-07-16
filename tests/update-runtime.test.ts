import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('runtime update', () => {
  it('restarts every long-running service after building and migrating', async () => {
    const script = await readFile('update.sh', 'utf8');
    const restart = script.indexOf('systemctl --user restart');

    expect(restart).toBeGreaterThan(script.indexOf('npm run build'));
    expect(restart).toBeGreaterThan(script.indexOf('npm run db:migrate'));
    expect(script).toContain('systemctl --user is-active --quiet obs-live-studio.target');
    for (const service of [
      'obs-live-studio-api.service',
      'obs-live-studio-worker.service',
      'obs-live-studio-broadcast-runner.service',
      'obs-live-studio-overlay-renderer.service',
      'obs-live-studio-desktop-agent.service',
      'obs-live-studio-web.service',
    ]) {
      expect(script).toContain(service);
    }
  });
});
