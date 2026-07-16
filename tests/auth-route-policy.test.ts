import { describe, expect, it } from 'vitest';
import { isCsrfExemptAuthPath, isPublicAuthPath } from '../apps/api/src/auth.js';

describe('Auth-Routenrichtlinie', () => {
  it.each([
    '/api/auth/session',
    '/api/auth/session?refresh=1',
    '/api/auth/setup',
    '/api/auth/login',
    '/api/auth/setup-required',
  ])('erlaubt die exakte öffentliche Route %s', (url) => {
    expect(isPublicAuthPath(url)).toBe(true);
  });

  it.each(['/api/auth/session-token', '/api/auth/setup/admin', '/api/auth/login-callback'])(
    'erlaubt keine Route nur aufgrund eines gemeinsamen Präfixes: %s',
    (url) => {
      expect(isPublicAuthPath(url)).toBe(false);
    },
  );

  it.each(['/api/auth/login', '/api/auth/login?next=%2F', '/api/auth/setup'])(
    'nimmt nur die exakte Route %s von der CSRF-Prüfung aus',
    (url) => {
      expect(isCsrfExemptAuthPath(url)).toBe(true);
    },
  );

  it.each(['/api/auth/login-callback', '/api/auth/setup/admin', '/api/auth/session'])(
    'behält die CSRF-Prüfung für %s bei',
    (url) => {
      expect(isCsrfExemptAuthPath(url)).toBe(false);
    },
  );
});
