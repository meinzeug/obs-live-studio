#!/usr/bin/env node
import { createStudioBackup } from './studio-backup-lib.mjs';

const json = process.argv.includes('--json');
try {
  const result = await createStudioBackup();
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Studio backup created: ${result.directory}`);
    console.log(`Verified artifacts: ${result.verification.artifacts.length}`);
    if (result.removed.length > 0) console.log(`Removed expired backups: ${result.removed.length}`);
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
  }
} catch (error) {
  if (json) console.error(JSON.stringify({ ok: false, error: error.message }));
  else console.error(`Studio backup failed: ${error.message}`);
  process.exitCode = 1;
}
