import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const textContracts = [
  {
    id: 'readme-installation',
    path: 'README.md',
    includes: [
      './install.sh',
      'PostgreSQL',
      'Multiple RTMP Outputs',
      'systemd --user',
      'Wiederherstellungsproben-Timer',
    ],
  },
  {
    id: 'readme-runtime-commands',
    path: 'README.md',
    includes: [
      'npm run studio:preflight',
      'npm run studio:verify',
      'npm run studio:audit',
      'OBS_STALE_ARTIFACT_MIN_AGE_MS',
      '39 Verträge',
      '.github/workflows/ci.yml',
      'Störungen, Hinweise und manuelle Quellenabrufe',
      'Quellenmonitor und Abrufdiagnose',
    ],
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
    includes: ['argumentationskette-twitch', 'Encoder-Sharing', 'TWITCH_STREAM_KEY', 'var/backups/obs-config-*'],
  },
  {
    id: 'reproducible-install',
    path: 'install.sh',
    includes: ['npm ci --no-audit --no-fund', 'npm run studio:audit -- --json', 'npm run build', 'procps'],
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
      'safeEditorialSourceUrl',
    ],
  },
  {
    id: 'editorial-source-link-safety',
    path: 'apps/web/src/editorial-source.ts',
    includes: ["url.protocol === 'http:'", "url.protocol === 'https:'", 'return null'],
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
    id: 'obs-config-transaction',
    path: 'scripts/configure-obs.mjs',
    includes: [
      'commitPrivateObsConfiguration',
      'globalFile',
      'userFile',
      'websocketFile',
      'serviceFile',
      'collectionFile',
    ],
  },
  {
    id: 'obs-config-backup-integrity',
    path: 'scripts/obs-config-files.mjs',
    includes: [
      "createHash('sha256')",
      'manifest.json',
      'writePrivateAtomic',
      'metadata.isFile()',
      'backupDirectory',
    ],
  },
  {
    id: 'complete-obs-preflight',
    path: 'scripts/studio-preflight-lib.mjs',
    includes: [
      'obs-global-config',
      'obs-user-config',
      'obs-websocket-config',
      'obs-scene-collection',
      'obs-stream-service',
    ],
  },
  {
    id: 'desktop-agent-stale-artifacts',
    path: 'apps/desktop-agent/src/obs-runtime-files.ts',
    includes: ['minimumAgeMs', 'runningObsPids', 'skippedFresh', 'writePrivatePidFile', 'PRIVATE_FILE_MODE'],
  },
  {
    id: 'desktop-agent-single-instance',
    path: 'apps/desktop-agent/src/index.ts',
    includes: ['discoverUserObsPids', 'außerhalb des Desktop-Agenten', 'OBS_STALE_ARTIFACT_MIN_AGE_MS'],
  },
  {
    id: 'github-actions-full-ci',
    path: '.github/workflows/ci.yml',
    includes: [
      'pull_request:',
      'branches: [main]',
      'mcr.microsoft.com/playwright:v1.61.1-noble',
      'postgres:16',
      'npm run ci',
      'actions/upload-artifact@v4',
    ],
  },
  {
    id: 'operational-notification-migration',
    path: 'packages/database/src/migrate.ts',
    includes: ['008_operational_notifications.sql'],
  },
  {
    id: 'operational-notification-storage',
    path: 'packages/database/src/notifications.ts',
    includes: [
      'upsertOperationalNotification',
      'resolveOperationalNotification',
      'notification_reads',
      'unreadOperationalNotificationCount',
      'queueSourceFetch',
    ],
  },
  {
    id: 'operational-notification-api',
    path: 'apps/api/src/operations-routes.ts',
    includes: [
      '/api/notifications',
      '/api/notifications/read-all',
      '/api/notifications/:id/read',
      '/api/sources/:id/refresh',
      'auditLog',
    ],
  },
  {
    id: 'operational-notification-ui',
    path: 'apps/web/src/pages/NotificationsPage.tsx',
    includes: ['Störungen und Hinweise', 'Alle quittieren', 'Behobene Meldungen anzeigen', 'user_read_at'],
  },
  {
    id: 'source-failure-notifications',
    path: 'apps/worker/src/index.ts',
    includes: [
      'upsertOperationalNotification',
      'resolveOperationalNotification',
      'consecutiveErrors',
      'notification_write_failed',
    ],
  },
  {
    id: 'broadcast-runner-notifications',
    path: 'apps/broadcast-runner/src/index.ts',
    includes: [
      'RUNNER_FAILURE_KEY',
      'RUNNER_OBS_KEY',
      'upsertOperationalNotification',
      'resolveOperationalNotification',
    ],
  },
  {
    id: 'manual-source-operations',
    path: 'apps/web/src/pages/SourcesPage.tsx',
    includes: ['Jetzt abrufen', 'Pausieren', 'Aktivieren', '/refresh'],
  },
  {
    id: 'source-health-migration',
    path: 'packages/database/src/migrate.ts',
    includes: ['009_source_health.sql'],
  },
  {
    id: 'source-health-storage',
    path: 'packages/database/src/source-health-store.ts',
    includes: ['listSourceHealth', 'getSourceHealth', 'summarizeSourceHealth', 'source_checks'],
  },
  {
    id: 'source-health-api',
    path: 'apps/api/src/operations-routes.ts',
    includes: ['/api/sources/health', '/api/sources/:id/health', 'summarizeSourceHealthOverview'],
  },
  {
    id: 'source-health-ui',
    path: 'apps/web/src/pages/SourceHealthPage.tsx',
    includes: ['Quellenmonitor', 'Verfügbarkeit', 'Jetzt abrufen', 'recentChecks'],
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
