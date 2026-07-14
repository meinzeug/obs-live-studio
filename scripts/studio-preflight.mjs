import { runCompleteStudioPreflight } from './complete-studio-preflight.mjs';

const args = new Set(process.argv.slice(2));
const scopeArgument = process.argv.slice(2).find((argument) => argument.startsWith('--scope='));
const scope = scopeArgument?.slice('--scope='.length) || 'all';
const json = args.has('--json');
const checkDatabase = !args.has('--no-database');

const report = await runCompleteStudioPreflight({ scope, checkDatabase });

if (json) {
  console.log(JSON.stringify(report));
} else {
  console.log(`Studio-Vorabprüfung: ${report.ok ? 'BESTANDEN' : 'FEHLGESCHLAGEN'} (${report.scope})`);
  for (const check of report.checks) {
    const marker = check.status === 'ok' ? '✓' : check.status === 'disabled' ? '–' : '✗';
    console.log(`${marker} ${check.message}${check.detail ? ` (${check.detail})` : ''}`);
  }
  console.log(
    `${report.summary.passed} bestanden, ${report.summary.disabled} deaktiviert, ${report.summary.errors} Fehler`,
  );
}

if (!report.ok) process.exitCode = 1;
