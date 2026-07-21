import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('runtime update', () => {
  it('repairs local database credentials before migrating and restarting services', async () => {
    const script = await readFile('update.sh', 'utf8');
    const pull = script.indexOf('git pull --ff-only');
    const reexecute = script.indexOf('exec "$repo_dir/update.sh"');
    const install = script.indexOf('npm ci --no-audit --no-fund');
    const build = script.indexOf('npm run build');
    const provisionDatabase = script.indexOf('scripts/provision-postgres.sh');
    const backup = script.indexOf('npm run studio:backup');
    const configureEnvironment = script.indexOf('node scripts/configure-env.mjs');
    const installTts = script.indexOf('npm run studio:tts:install');
    const inspectTts = script.indexOf('npm run studio:tts:status -- --json');
    const migrate = script.indexOf('npm run db:migrate');
    const installServices = script.indexOf('scripts/install-user-services.sh');
    const restart = script.indexOf('systemctl --user restart "$service"');

    expect(reexecute).toBeGreaterThan(pull);
    expect(install).toBeGreaterThan(reexecute);
    expect(build).toBeGreaterThan(install);
    expect(provisionDatabase).toBeGreaterThan(build);
    expect(backup).toBeGreaterThan(provisionDatabase);
    expect(configureEnvironment).toBeGreaterThan(backup);
    expect(installTts).toBeGreaterThan(configureEnvironment);
    expect(inspectTts).toBeGreaterThan(installTts);
    expect(migrate).toBeGreaterThan(inspectTts);
    expect(installServices).toBeGreaterThan(migrate);
    expect(restart).toBeGreaterThan(installServices);
    expect(script).not.toContain('npm run db:migrate || true');
    expect(script).not.toContain('npm install');
    expect(script).toContain('systemctl --user is-active --quiet obs-live-studio.target');
    expect(script).toContain('systemctl --user show-environment');
    expect(script).toContain('failed_services=()');
    expect(script).toContain('systemctl --user --no-pager --full status "$service"');
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
    expect(script.indexOf('obs-live-studio-desktop-agent.service')).toBeLessThan(
      script.indexOf('obs-live-studio-broadcast-runner.service'),
    );
  });

  it('does not block the desktop agent on the full OBS diagnostic preflight', async () => {
    const unit = await readFile('deploy/systemd/obs-live-studio-desktop-agent.service', 'utf8');

    expect(unit).toContain('ExecStart=');
    expect(unit).toContain('UMask=0077');
    expect(unit).not.toContain('ExecStartPre=');
    expect(unit).not.toContain('studio:preflight');
  });

  it('avoids privileged PostgreSQL changes when the configured credentials already work', async () => {
    const script = await readFile('scripts/provision-postgres.sh', 'utf8');
    const connectionCheck = script.indexOf("await client.query('select 1')");
    const privilegedProvisioning = script.indexOf('sudo systemctl enable --now postgresql');

    expect(connectionCheck).toBeGreaterThan(0);
    expect(privilegedProvisioning).toBeGreaterThan(connectionCheck);
    expect(script.slice(connectionCheck, privilegedProvisioning)).toContain('exit 0');
  });
});
