import { describe, expect, it } from 'vitest';
import { scriptWithChannelName } from '@ans/content-processing';

describe('speaker script channel identity', () => {
  it('replaces the legacy station ident before TTS generation', () => {
    expect(scriptWithChannelName('Argumentationskette. Die Nachricht beginnt jetzt.', 'Zeitkante')).toBe(
      'Zeitkante. Die Nachricht beginnt jetzt.',
    );
  });

  it('uses stored aliases after later station renames and does not duplicate the current name', () => {
    expect(scriptWithChannelName('Zeitkante. Eine neue Meldung.', 'Neuer Sender', ['Zeitkante'])).toBe(
      'Neuer Sender. Eine neue Meldung.',
    );
    expect(scriptWithChannelName('Neuer Sender. Eine neue Meldung.', 'Neuer Sender', ['Zeitkante'])).toBe(
      'Neuer Sender. Eine neue Meldung.',
    );
  });
});
