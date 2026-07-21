import { describe, expect, it } from 'vitest';
import {
  addressChatResponse,
  ensureResearchAttribution,
  ensureVerifiedResearchAnswer,
  fitChatResponseToDuration,
  limitedResearchChatAnswer,
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
    expect(addressChatResponse('Dennis_Wicht', 'Die Quellenlage ist noch offen.', true)).toBe(
      'Dennis_Wicht: Die Quellenlage ist noch offen.',
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

  it('uses a transparent bounded fallback when the research desk found no defensible answer', () => {
    expect(limitedResearchChatAnswer([{ publisher: 'Wikipedia (de)' }])).toBe(
      'Unsere aktuelle Recherche bei Wikipedia (de) liefert dafür keine belastbare Begründung.',
    );
    expect(limitedResearchChatAnswer([])).toBe('Unsere aktuelle Recherche liefert dafür keine belastbare Begründung.');
  });

  it('fits the spoken answer and follow-up into the configured on-air slot', () => {
    const fitted = fitChatResponseToDuration(
      'Dennis: Diese sehr lange Antwort enthält absichtlich deutlich mehr Wörter als während einer kurzen Einblendung natürlich und verständlich gesprochen werden können und muss deshalb sauber begrenzt werden.',
      'Welche konkrete Aussage aus dem laufenden Beitrag sollen Redaktion und Faktenprüfung als Nächstes untersuchen?',
      10,
    );
    const spokenWords = `${fitted.response} ${fitted.followUpQuestion}`.trim().split(/\s+/u);

    expect(spokenWords.length).toBeLessThanOrEqual(19);
    expect(fitted.response).toMatch(/^Dennis:/u);
    expect(fitted.response).not.toContain('…');
    expect(fitted.followUpQuestion).not.toContain('…');
  });
});
