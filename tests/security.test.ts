import { describe, it, expect } from 'vitest';
import { maskSecret, redactLog } from '../packages/security/src/index.js';
describe('security helpers', () => {
  it('masks secrets and redacts logs', () => {
    expect(maskSecret('abcdefghijkl')).toBe('abcd••••ijkl');
    expect(redactLog({ streamKey: 'x', ok: 1 }).streamKey).toBe('[REDACTED]');
  });
});
