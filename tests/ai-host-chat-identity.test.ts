import { describe, expect, it } from 'vitest';
import {
  addressChatResponse,
  ensureResearchAttribution,
  ensureVerifiedResearchAnswer,
  safeChatDisplayName,
} from '../apps/api/src/ai-host-chat.js';

describe('AI host chat identity', () => {
  it('cleans a public display name and addresses the viewer exactly once', () => {
    expect(safeChatDisplayName('  Dennis_Wicht<script>  ')).toBe('Dennis_Wichtscript');
    expect(addressChatResponse('Dennis_Wicht', 'Die Quelle ist im Material nicht angegeben.')).toBe(
      'Dennis_Wicht, zu deiner Frage: Die Quelle ist im Material nicht angegeben.',
    );
    expect(addressChatResponse('Dennis_Wicht', 'Dennis_Wicht, die Quelle ist noch offen.')).toBe(
      'Dennis_Wicht, die Quelle ist noch offen.',
    );
    expect(addressChatResponse('Dennis_Wicht', 'Hallo Dennis_Wicht! Laut Wikipedia ist das belegt.')).toBe(
      'Hallo Dennis_Wicht! Laut Wikipedia ist das belegt.',
    );
    expect(addressChatResponse('Dennis_Wicht', 'Die Antwort für Dennis_Wicht ist noch offen.')).toBe(
      'Dennis_Wicht, zu deiner Frage: Die Antwort für Dennis_Wicht ist noch offen.',
    );
  });

  it('keeps the response anonymous when no approved display name is available', () => {
    expect(safeChatDisplayName('<>')).toBeNull();
    expect(addressChatResponse(null, 'Die Redaktion prüft das.')).toBe('Die Redaktion prüft das.');
  });

  it('keeps a visible source attribution even when the free model omits it', () => {
    expect(
      ensureResearchAttribution('Die biografische Angabe ist belegt.', [
        { publisher: 'Wikipedia (de)', title: 'Daniele Ganser' },
      ]),
    ).toContain('Als Recherchequelle diente Wikipedia (de): „Daniele Ganser“.');
    expect(
      ensureResearchAttribution('Laut Wikipedia (de) ist die Angabe belegt.', [
        { publisher: 'Wikipedia (de)', title: 'Daniele Ganser' },
      ]),
    ).toBe('Laut Wikipedia (de) ist die Angabe belegt.');
    expect(
      ensureResearchAttribution('Dazu liegen keine belastbaren Informationen vor.', [
        { publisher: 'YouTube · Testkanal', title: 'Testvideo' },
      ]),
    ).toContain('weitergehende Angaben waren dort nicht belegt');
  });

  it('replaces an evasive video answer when the newsroom extracted a verified birthplace', () => {
    const fact = {
      value: 'Freudenstadt',
      statement: 'Laut Wikipedia (de) wurde Rainer Rothfuß in Freudenstadt geboren.',
    };
    expect(ensureVerifiedResearchAnswer('Rainer Rotfuß ist Teil des Videos.', fact)).toBe(fact.statement);
    expect(ensureVerifiedResearchAnswer('Laut Wikipedia wurde Rainer Rothfuß in Freudenstadt geboren.', fact)).toBe(
      'Laut Wikipedia wurde Rainer Rothfuß in Freudenstadt geboren.',
    );
  });
});
