import { inspectStreamingConfiguration } from './streaming-runtime-status.mjs';

const report = inspectStreamingConfiguration(process.env);
const json = process.argv.includes('--json');

if (json) {
  console.log(JSON.stringify(report));
} else {
  console.log(`${report.studio.studioName} – ${report.studio.channelName}`);
  console.log(`Hauptziel: ${report.primary?.name ?? 'ungültig'} (${report.primary?.platform ?? 'unbekannt'})`);
  for (const target of report.additionalTargets.filter((item) => item.enabled)) {
    console.log(`Zusätzlich: ${target.name} (${target.platform})`);
  }
  for (const check of report.checks) {
    const marker = check.status === 'ok' ? '✓' : check.status === 'disabled' ? '–' : '✗';
    console.log(`${marker} ${check.message}`);
  }
}

if (!report.ok) process.exitCode = 1;
