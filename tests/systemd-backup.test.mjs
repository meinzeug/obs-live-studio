import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const readRepositoryFile = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

describe('scheduled verified backups', () => {
  it('runs the verified backup as a hardened low-priority oneshot service', async () => {
    const service = await readRepositoryFile('deploy/systemd/obs-live-studio-backup.service');

    expect(service).toContain('Type=oneshot');
    expect(service).toContain('EnvironmentFile=%h/obs-live-studio/.env');
    expect(service).toContain('UMask=0077');
    expect(service).toContain('studio:preflight -- --scope=configuration --json');
    expect(service).toContain('studio:backup -- --json');
    expect(service).toContain('CPUWeight=20');
    expect(service).toContain('IOWeight=20');
    expect(service).toContain('NoNewPrivileges=true');
    expect(service).not.toContain('Restart=always');
  });

  it('schedules one persistent daily run with bounded random delay', async () => {
    const timer = await readRepositoryFile('deploy/systemd/obs-live-studio-backup.timer');

    expect(timer).toContain('OnCalendar=*-*-* 03:30:00');
    expect(timer).toContain('RandomizedDelaySec=30m');
    expect(timer).toContain('AccuracySec=1m');
    expect(timer).toContain('Persistent=true');
    expect(timer).toContain('Unit=obs-live-studio-backup.service');
    expect(timer).toContain('WantedBy=timers.target');
  });

  it('installs timer units and activates the backup timer', async () => {
    const installer = await readRepositoryFile('scripts/install-user-services.sh');

    expect(installer).toContain('obs-live-studio*.timer');
    expect(installer).toContain('systemctl --user enable --now obs-live-studio-backup.timer');
    expect(installer).toContain('systemctl --user daemon-reload');
  });
});
