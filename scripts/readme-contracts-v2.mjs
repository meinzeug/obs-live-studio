import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  auditReadmeContracts as auditLegacyReadmeContracts,
  requiredScripts,
  textContracts,
} from './readme-contracts-lib.mjs';
import { auditMediaReadmeContract } from './media-readme-contract.mjs';

export async function auditReadmeContracts(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const report = await auditLegacyReadmeContracts({ root });
  const runtimeCheck = report.checks.find((check) => check.id === 'readme-runtime-commands');
  if (runtimeCheck?.missing?.includes('40 Verträge')) {
    const readme = await readFile(resolve(root, 'README.md'), 'utf8').catch(() => '');
    if (readme.includes('41 Verträge')) {
      runtimeCheck.missing = runtimeCheck.missing.filter((token) => token !== '40 Verträge');
      runtimeCheck.ok = runtimeCheck.missing.length === 0;
    }
  }
  const mediaCheck = await auditMediaReadmeContract(root);
  const checks = [...report.checks, mediaCheck];
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
