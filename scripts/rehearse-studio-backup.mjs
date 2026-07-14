#!/usr/bin/env node
import { resolve } from 'node:path';
import { rehearseStudioBackup } from './studio-backup-rehearsal-lib.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const keepWorkspace = args.includes('--keep-workspace');
const backupDirectory = args.find((argument) => !argument.startsWith('--'));

try {
  const report = await rehearseStudioBackup({
    backupDirectory: backupDirectory ? resolve(backupDirectory) : undefined,
    keepWorkspace,
  });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    console.log(`Backup restore rehearsal passed: ${report.backupDirectory}`);
    console.log(`Application files: ${report.application.files}`);
    if (report.database.included) console.log(`Database restore entries: ${report.database.tocEntries}`);
    if (report.workspace) console.log(`Workspace kept at: ${report.workspace}`);
  } else {
    console.error(`Backup restore rehearsal failed: ${report.backupDirectory}`);
    for (const error of report.errors) console.error(`- ${error}`);
    if (report.workspace) console.error(`Workspace kept at: ${report.workspace}`);
  }
  process.exitCode = report.ok ? 0 : 1;
} catch (error) {
  if (json) console.error(JSON.stringify({ ok: false, error: error.message }));
  else console.error(`Backup restore rehearsal failed: ${error.message}`);
  process.exitCode = 1;
}
