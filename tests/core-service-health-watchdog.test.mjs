import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  coreServiceHealthChecks,
  evaluateCoreServiceRepair,
  runCoreServiceHealthWatchdog,
} from '../scripts/core-service-health-watchdog.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('core service health watchdog', () => {
  it('installs a hardened recurring user service without loading the studio secret file', async () => {
    const [service, timer, target, installer, renderer] = await Promise.all([
      readFile('deploy/systemd/obs-live-studio-core-health.service', 'utf8'),
      readFile('deploy/systemd/obs-live-studio-core-health.timer', 'utf8'),
      readFile('deploy/systemd/obs-live-studio.target', 'utf8'),
      readFile('scripts/install-user-services.sh', 'utf8'),
      readFile('apps/overlay-renderer/src/index.ts', 'utf8'),
    ]);

    expect(service).toContain('core-service-health-watchdog.mjs --repair');
    expect(service).not.toContain('EnvironmentFile=');
    expect(service).toContain('NoNewPrivileges=true');
    expect(service).toContain('PartOf=obs-live-studio.target');
    expect(timer).toContain('OnUnitInactiveSec=30s');
    expect(timer).toContain('PartOf=obs-live-studio.target');
    expect(timer).not.toContain('WantedBy=timers.target');
    expect(target).toContain('obs-live-studio-core-health.timer');
    expect(installer).toContain('disable obs-live-studio-core-health.timer');
    expect(installer).toContain('is-active --quiet obs-live-studio.target');
    expect(installer).not.toMatch(/enable --now[\s\\\n]+(?:[^\n]+\n)*\s+obs-live-studio-core-health\.timer/);
    expect(renderer).toContain("app.get('/health'");
  });

  it('accepts only local, credential-free health URLs', () => {
    const checks = coreServiceHealthChecks({ CORE_HEALTH_API_URL: 'http://127.0.0.1:19000/health' });
    expect(checks[0].url).toBe('http://127.0.0.1:19000/health');
    expect(checks.some((check) => check.id === 'worker' && check.url.endsWith(':12101/health'))).toBe(true);
    expect(() => coreServiceHealthChecks({ CORE_HEALTH_API_URL: 'https://example.org/health' })).toThrow(
      /lokale HTTP-URLs/,
    );
    expect(() => coreServiceHealthChecks({ CORE_HEALTH_API_URL: 'http://user:secret@localhost/health' })).toThrow(
      /ohne Zugangsdaten/,
    );
  });

  it('repairs only repeated transport failures and observes a restart cooldown', () => {
    const first = evaluateCoreServiceRepair(
      {},
      { processActive: true, reachable: false },
      {
        nowMs: 1_000_000,
        failureThreshold: 2,
        cooldownMs: 60_000,
      },
    );
    expect(first).toMatchObject({ shouldRestart: false, state: { failures: 1 } });
    const second = evaluateCoreServiceRepair(
      first.state,
      { processActive: true, reachable: false },
      {
        nowMs: 1_001_000,
        failureThreshold: 2,
        cooldownMs: 60_000,
      },
    );
    expect(second).toMatchObject({ shouldRestart: true, state: { failures: 2 } });
    const coolingDown = evaluateCoreServiceRepair(
      { failures: 3, lastRestartAt: new Date(1_000_000).toISOString() },
      { processActive: true, reachable: false },
      { nowMs: 1_001_000, failureThreshold: 2, cooldownMs: 60_000 },
    );
    expect(coolingDown.shouldRestart).toBe(false);
    expect(evaluateCoreServiceRepair(second.state, { processActive: true, reachable: true }, {}).state.failures).toBe(
      0,
    );
  });

  it('persists failures and restarts only the repeatedly unreachable unit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'obs-live-studio-core-health-'));
    temporaryDirectories.push(root);
    const stateFile = join(root, 'state.json');
    const check = { id: 'api', unit: 'obs-live-studio-api.service', url: 'http://127.0.0.1:19000/health' };
    const restarted = [];
    const options = {
      checks: [check],
      stateFile,
      env: { CORE_HEALTH_FAILURE_THRESHOLD: '2', CORE_HEALTH_RESTART_COOLDOWN_MS: '60000' },
      unitActive: async () => true,
      fetchImpl: async () => {
        throw new Error('timeout');
      },
      restartUnit: async (unit) => restarted.push(unit),
      repair: true,
    };

    const first = await runCoreServiceHealthWatchdog({ ...options, nowMs: 1_000_000 });
    expect(first.results[0]).toMatchObject({ status: 'unreachable', consecutiveFailures: 1, action: 'none' });
    const second = await runCoreServiceHealthWatchdog({ ...options, nowMs: 1_061_000 });
    expect(second.results[0]).toMatchObject({ status: 'unreachable', consecutiveFailures: 0, action: 'restarted' });
    expect(restarted).toEqual(['obs-live-studio-api.service']);
    const persisted = JSON.parse(await readFile(stateFile, 'utf8'));
    expect(persisted.services.api.lastRestartAt).toBe(new Date(1_061_000).toISOString());
  });

  it('limits each repair pass to one targeted restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'obs-live-studio-core-health-'));
    temporaryDirectories.push(root);
    const restarted = [];
    const checks = ['api', 'web'].map((id) => ({
      id,
      unit: `obs-live-studio-${id}.service`,
      url: `http://127.0.0.1:19${id === 'api' ? '000' : '001'}/health`,
    }));
    const common = {
      checks,
      stateFile: join(root, 'state.json'),
      env: { CORE_HEALTH_FAILURE_THRESHOLD: '1', CORE_HEALTH_MAX_RESTARTS_PER_RUN: '1' },
      unitActive: async () => true,
      fetchImpl: async () => {
        throw new Error('timeout');
      },
      restartUnit: async (unit) => restarted.push(unit),
      repair: true,
    };

    const report = await runCoreServiceHealthWatchdog(common);

    expect(restarted).toEqual(['obs-live-studio-api.service']);
    expect(report.results.map((result) => result.action)).toEqual(['restarted', 'deferred']);
  });

  it('reports an application-level 503 as degraded without restarting a responsive process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'obs-live-studio-core-health-'));
    temporaryDirectories.push(root);
    const restarted = [];
    const report = await runCoreServiceHealthWatchdog({
      checks: [
        {
          id: 'runner',
          unit: 'obs-live-studio-broadcast-runner.service',
          url: 'http://127.0.0.1:19100/ready',
          bodyReady: (body) => body?.ready === true,
        },
      ],
      stateFile: join(root, 'state.json'),
      unitActive: async () => true,
      fetchImpl: async () =>
        new Response(JSON.stringify({ ready: false }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
      restartUnit: async (unit) => restarted.push(unit),
      repair: true,
    });

    expect(report.results[0]).toMatchObject({ status: 'degraded', reachable: true, action: 'none' });
    expect(restarted).toEqual([]);
  });

  it('restarts a responsive runner only when it explicitly reports a fenced playout stall', async () => {
    const root = await mkdtemp(join(tmpdir(), 'obs-live-studio-core-health-'));
    temporaryDirectories.push(root);
    const restarted = [];
    const check = coreServiceHealthChecks({}).find((candidate) => candidate.id === 'broadcast-runner');
    const report = await runCoreServiceHealthWatchdog({
      checks: [check],
      stateFile: join(root, 'state.json'),
      env: { CORE_HEALTH_FAILURE_THRESHOLD: '1' },
      unitActive: async () => true,
      fetchImpl: async () =>
        new Response(JSON.stringify({ ready: false, restartRecommended: true }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
      restartUnit: async (unit) => restarted.push(unit),
      repair: true,
    });

    expect(report.results[0]).toMatchObject({ status: 'degraded', action: 'restarted' });
    expect(restarted).toEqual(['obs-live-studio-broadcast-runner.service']);
  });

  it('never resurrects services while the station target is stopped for maintenance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'obs-live-studio-core-health-'));
    temporaryDirectories.push(root);
    const restarted = [];
    const unitActive = async (unit) => unit !== 'obs-live-studio.target';
    const report = await runCoreServiceHealthWatchdog({
      checks: [{ id: 'api', unit: 'obs-live-studio-api.service', url: 'http://127.0.0.1:19000/health' }],
      stateFile: join(root, 'state.json'),
      env: { CORE_HEALTH_FAILURE_THRESHOLD: '1' },
      unitActive,
      fetchImpl: async () => {
        throw new Error('maintenance');
      },
      restartUnit: async (unit) => restarted.push(unit),
      repair: true,
    });

    expect(report).toMatchObject({ repair: false, repairRequested: true, stationTargetActive: false });
    expect(report.results[0]).toMatchObject({ consecutiveFailures: 0 });
    expect(restarted).toEqual([]);
  });
});
