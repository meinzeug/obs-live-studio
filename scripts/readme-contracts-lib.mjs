import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const textContracts = [
  {
    id: 'readme-installation',
    path: 'README.md',
    includes: ['./install.sh', 'PostgreSQL', 'Multiple RTMP Outputs', 'systemd --user', 'Wiederherstellungsproben-Timer'],
  },
  {
    id: 'readme-runtime-commands',
    path: 'README.md',
    includes: ['npm run studio:preflight', 'npm run studio:verify', 'npm run studio:audit'],
  },
  {
    id: 'readme-editorial-policy',
    path: 'README.md',
    includes: ['aktiven und nicht gelöschten Quelle', 'Warnhinweisen', 'manuellen Prüfung', 'Quellenattribution'],
  },
  {
    id: 'readme-backups',
    path: 'README.md',
    includes: ['npm run studio:backup', 'npm run studio:backup:rehearse', 'BACKUP_MAX_AGE_HOURS'],
  },
  {
    id: 'readme-multistream',
    path: 'README.md',
    includes: ['argumentationskette-twitch', 'Encoder-Sharing', 'TWITCH_STREAM_KEY'],
  },
  {
    id: 'reproducible-install',
    path: 'install.sh',
    includes: ['npm ci --no-audit --no-fund', 'npm run studio:audit -- --json', 'npm run build'],
  },
  {
    id: 'installation-provisions-advertised-components',
    path: 'install.sh',
    includes: [
      'scripts/provision-postgres.sh',
      'npm run db:migrate',
      'npm run db:seed',
      'npm run studio:sources',
      'npm run obs:configure',
      'npm run studio:preflight -- --scope=all --json',
      'scripts/install-user-services.sh',
    ],
  },
  {
    id: 'official-primary-sources',
    path: 'scripts/configure-official-sources.mjs',
    includes: ['bundesregierung.de', 'bundestag.de', 'licenseNotes', 'Originallink'],
  },
  {
    id: 'autopilot-active-source-policy',
    path: 'apps/worker/src/autopilot.ts',
    includes: [
      'select id from sources where active=true and deleted_at is null',
      'activeSourceIds',
      'streamIsReady(config.requireStream)',
      'existingBroadcast(article.id)',
      'isAutopilotCandidate(article, config.minimumTrust, configuredSourceIds, activeSources)',
    ],
  },
  {
    id: 'autopilot-candidate-policy',
    path: 'apps/worker/src/autopilot-policy.ts',
    includes: [
      "['new', 'review', 'approved']",
      'article.trust_score',
      'article.warnings?.length',
      'activeSourceIds.has(article.source_id)',
      'sourceIds.has(article.source_id)',
    ],
  },
  {
    id: 'editorial-warning-visibility',
    path: 'apps/web/src/pages/ArticlesPage.tsx',
    includes: ['Nur Beiträge mit Warnhinweisen', 'state-pill warning', 'article.warnings'],
  },
  {
    id: 'editorial-source-attribution',
    path: 'apps/web/src/pages/ArticleDetailPage.tsx',
    includes: [
      'Manuelle redaktionelle Prüfung erforderlich',
      'Quelle und Attribution',
      'Originalquelle öffnen',
      'window.confirm',
    ],
  },
  {
    id: 'verified-backup-commands',
    path: 'package.json',
    includes: ['studio:backup', 'studio:backup:verify', 'studio:backup:rehearse'],
  },
  {
    id: 'backup-timers-installed',
    path: 'scripts/install-user-services.sh',
    includes: ['obs-live-studio-backup.timer', 'obs-live-studio-backup-rehearsal.timer'],
  },
  {
    id: 'daily-backup-timer',
    path: 'deploy/systemd/obs-live-studio-backup.timer',
    includes: ['OnCalendar=*-*-* 03:30:00', 'Persistent=true'],
  },
  {
    id: 'weekly-restore-rehearsal',
    path: 'deploy/systemd/obs-live-studio-backup-rehearsal.timer',
    includes: ['OnCalendar=Sun *-*-* 05:30:00', 'Persistent=true'],
  },
  {
    id: 'backup-health-status',
    path: 'apps/api/src/backup-health.ts',
    includes: ['BACKUP_MAX_AGE_HOURS', 'BACKUP_REHEARSAL_MAX_AGE_HOURS', 'restore-rehearsal'],
  },
  {
    id: 'twitch-managed-target',
    path: 'scripts/obs-multi-rtmp-config.mjs',
    includes: ['argumentationskette-twitch', 'sync-start', 'sync-stop'],
  },
  {
    id: 'runtime-twitch-preflight',
    path: 'apps/api/src/twitch-preflight.ts',
    includes: ['sharesMainEncoders', 'targetMatchesEnvironment', 'configurationSecure'],
  },
  {
    id: 'all-runtime-services',
    path: 'deploy/systemd/obs-live-studio.target',
    includes: [
      'obs-live-studio-api.service',
      'obs-live-studio-web.service',
      'obs-live-studio-worker.service',
      'obs-live-studio-desktop-agent.service',
      'obs-live-studio-broadcast-runner.service',
      'obs-live-studio-overlay-renderer.service',
    ],
  },
];

const requiredScripts = [
  'build',
  'typecheck',
  'test',
  'studio:bootstrap',
  'studio:preflight',
  'studio:verify',
  'studio:audit',
  'studio:backup',
  'studio:backup:verify',
  'studio:backup:rehearse',
  'studio:sources',
  'obs:configure',
  'obs:install-multi-rtmp',
];

async function readRepositoryText(root, path) {
  return await readFile(resolve(root, path), 'utf8');
}

export async function auditReadmeContracts(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const checks = [];

  for (const contract of textContracts) {
    try {
      const text = await readRepositoryText(root, contract.path);
      const missing = contract.includes.filter((token) => !text.includes(token));
      checks.push({
        id: contract.id,
        path: contract.path,
        ok: missing.length === 0,
        missing,
      });
    } catch (error) {
      checks.push({
        id: contract.id,
        path: contract.path,
        ok: false,
        missing: contract.includes,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    const packageJson = JSON.parse(await readRepositoryText(root, 'package.json'));
    const missing = requiredScripts.filter((script) => typeof packageJson.scripts?.[script] !== 'string');
    checks.push({ id: 'package-runtime-scripts', path: 'package.json', ok: missing.length === 0, missing });
  } catch (error) {
    checks.push({
      id: 'package-runtime-scripts',
      path: 'package.json',
      ok: false,
      missing: requiredScripts,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    contracts: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  };
}

export { requiredScripts, textContracts };
