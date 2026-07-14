#!/usr/bin/env node
import { auditReadmeContracts } from './readme-contracts-lib.mjs';
import { auditMediaReadmeContract } from './media-readme-contract.mjs';

const json = process.argv.includes('--json');
const report = await auditReadmeContracts();
const mediaCheck = await auditMediaReadmeContract();
report.checks.push(mediaCheck);
report.contracts += 1;
if (mediaCheck.ok) report.passed += 1;
else report.failed += 1;
report.ok = report.failed === 0;

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
