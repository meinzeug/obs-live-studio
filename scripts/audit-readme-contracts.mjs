#!/usr/bin/env node
import { auditReadmeContracts } from './readme-contracts-lib.mjs';

const json = process.argv.includes('--json');
const report = await auditReadmeContracts();

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`README-Verträge: ${report.passed}/${report.contracts} erfüllt`);
  for (const check of report.checks) {
    const marker = check.ok ? '✓' : '✗';
    console.log(`${marker} ${check.id} (${check.path})`);
    if (!check.ok && check.missing?.length) console.log(`  Fehlend: ${check.missing.join(', ')}`);
  }
}

process.exitCode = report.ok ? 0 : 1;
