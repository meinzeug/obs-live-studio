#!/usr/bin/env node
import { resolve } from 'node:path';
import { verifyStudioBackup } from './studio-backup-lib.mjs';

const directory = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
const json = process.argv.includes('--json');
if (!directory) {
  console.error('Usage: npm run studio:backup:verify -- <backup-directory> [--json]');
  process.exit(2);
}

try {
  const report = await verifyStudioBackup(resolve(directory));
  if (json) console.log(JSON.stringify(report, null, 2));
  else if (report.ok) console.log(`Backup is valid: ${report.directory}`);
  else {
    console.error(`Backup verification failed: ${report.directory}`);
    for (const error of report.errors) console.error(`- ${error}`);
  }
  process.exitCode = report.ok ? 0 : 1;
} catch (error) {
  if (json) console.error(JSON.stringify({ ok: false, error: error.message }));
  else console.error(`Backup verification failed: ${error.message}`);
  process.exitCode = 1;
}
