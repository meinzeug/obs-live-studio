import { describe, expect, it } from 'vitest';
import {
  isCsrfExemptAuthPath,
  isPublicAuthPath,
  isPublicReadPath,
  isVerifiedOverlayMachinePath,
} from '../apps/api/src/auth.js';

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

  it('erlaubt den sanitisierten Artikel-Medienstatus öffentlich lesend, aber keine Mutationen', () => {
    const url = '/api/articles/7e2e7429-9b26-4760-ad43-082b7a8bb8a5/media';
    expect(isPublicReadPath('GET', url)).toBe(true);
    expect(isPublicReadPath('POST', url)).toBe(false);
    expect(isPublicReadPath('GET', `${url}/discover`)).toBe(false);
  });

  it('erlaubt OBS-Browserquellen ihre Medien und den read-only YouTube-Steuerstatus zu lesen', () => {
    expect(isPublicReadPath('GET', '/api/overlay/youtube-context/avatar/idle')).toBe(true);
    expect(isPublicReadPath('HEAD', '/api/overlay/youtube-context/avatar/chat')).toBe(true);
    expect(isPublicReadPath('GET', '/api/live/youtube/control/484d00fe-ba54-4b58-8235-6902da27c06a')).toBe(true);
    expect(isPublicReadPath('POST', '/api/live/youtube/control/484d00fe-ba54-4b58-8235-6902da27c06a')).toBe(false);
  });

  it('nimmt nur den selbst verifizierenden Ducking-Endpunkt als Maschinen-POST an', () => {
    expect(isVerifiedOverlayMachinePath('POST', '/api/overlay/audio-duck')).toBe(true);
    expect(isVerifiedOverlayMachinePath('POST', '/api/overlay/audio-duck?source=obs')).toBe(true);
    expect(isVerifiedOverlayMachinePath('GET', '/api/overlay/audio-duck')).toBe(false);
    expect(isVerifiedOverlayMachinePath('POST', '/api/overlay/audio-duck/other')).toBe(false);
    expect(isVerifiedOverlayMachinePath('POST', '/api/obs/setup')).toBe(false);
  });
});
