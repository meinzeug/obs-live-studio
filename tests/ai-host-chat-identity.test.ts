import { describe, expect, it } from 'vitest';
import {
  analyzeChatActivity,
  addressChatResponse,
  ensureResearchAttribution,
  ensureVerifiedResearchAnswer,
  fitChatResponseToDuration,
  isRepeatedChatDiscussion,
  limitedResearchChatAnswer,
  resolveChatDiscussionPolicy,
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

  it('keeps complete spoken sentences and lets measured TTS duration extend a short slot', () => {
    const fitted = fitChatResponseToDuration(
      'Dennis: Diese sehr lange Antwort enthält absichtlich deutlich mehr Wörter als während einer kurzen Einblendung natürlich und verständlich gesprochen werden können und muss deshalb sauber begrenzt werden.',
      'Welche konkrete Aussage aus dem laufenden Beitrag sollen Redaktion und Faktenprüfung als Nächstes untersuchen?',
      10,
    );

    expect(fitted.response).toBe(
      'Dennis: Diese sehr lange Antwort enthält absichtlich deutlich mehr Wörter als während einer kurzen Einblendung natürlich und verständlich gesprochen werden können und muss deshalb sauber begrenzt werden.',
    );
    expect(fitted.response).toMatch(/^Dennis:/u);
    expect(fitted.response).toMatch(/[.!?]$/u);
    expect(fitted.response).not.toMatch(/\b(?:und|der|die|das|von|mit)\.$/iu);
    expect(fitted.response).not.toContain('…');
    expect(fitted.followUpQuestion).toBe('');
  });

  it('uses a three-minute Sam-to-Mia cadence and lets the slower agent setting win', () => {
    expect(resolveChatDiscussionPolicy(undefined, undefined)).toMatchObject({
      enabled: true,
      analysisIntervalSeconds: 180,
      commentaryIntervalSeconds: 180,
      effectiveIntervalSeconds: 180,
      activityWindowSeconds: 360,
      minimumDistinctMessages: 3,
      minimumUniqueAuthors: 2,
      duplicateSuppressionMinutes: 30,
      commentaryDurationSeconds: 20,
    });
    expect(
      resolveChatDiscussionPolicy(
        { chatAnalysisIntervalSeconds: 240, chatAnalysisEnabled: true },
        { chatCommentaryIntervalSeconds: 120, proactiveChatCommentary: true },
      ).effectiveIntervalSeconds,
    ).toBe(240);
    expect(resolveChatDiscussionPolicy({ chatAnalysisEnabled: false }, { proactiveChatCommentary: true }).enabled).toBe(
      false,
    );
  });

  it('recognizes only a real recent discussion by several viewers as chat activity', () => {
    const now = Date.parse('2026-07-21T12:00:00.000Z');
    const policy = resolveChatDiscussionPolicy(undefined, undefined);
    const active = analyzeChatActivity(
      [
        {
          id: '1',
          provider: 'twitch',
          authorName: 'Anna',
          authorChannelId: 'anna',
          message: 'Die Energiepreise im Beitrag sind für Haushalte entscheidend.',
          publishedAt: '2026-07-21T11:58:10.000Z',
        },
        {
          id: '2',
          provider: 'youtube',
          authorName: 'Ben',
          authorChannelId: 'ben',
          message: 'Beim Netzausbau fehlen mir konkrete Zahlen zu den Kosten.',
          publishedAt: '2026-07-21T11:59:00.000Z',
        },
        {
          id: '3',
          provider: 'twitch',
          authorName: 'Anna',
          authorChannelId: 'anna',
          message: 'Mich interessiert besonders, wie schnell der Netzausbau umgesetzt wird.',
          publishedAt: '2026-07-21T11:59:40.000Z',
        },
      ],
      policy,
      now,
    );

    expect(active).toMatchObject({
      active: true,
      reason: 'active',
      distinctMessageCount: 3,
      uniqueAuthorCount: 2,
      providers: ['twitch', 'youtube'],
    });
    expect(active.keywords).toContain('netzausbau');
    expect(active.fingerprint).toMatch(/^v1:/u);

    const inactive = analyzeChatActivity(
      [
        {
          id: 'old',
          provider: 'twitch',
          authorName: 'Anna',
          authorChannelId: 'anna',
          message: 'Das war vor langer Zeit ein anderes Thema.',
          publishedAt: '2026-07-21T11:30:00.000Z',
        },
        {
          id: 'repeat-1',
          provider: 'twitch',
          authorName: 'Anna',
          authorChannelId: 'anna',
          message: 'Die Energiepreise sind wichtig.',
          publishedAt: '2026-07-21T11:59:00.000Z',
        },
        {
          id: 'repeat-2',
          provider: 'youtube',
          authorName: 'Ben',
          authorChannelId: 'ben',
          message: 'Die Energiepreise sind wichtig.',
          publishedAt: '2026-07-21T11:59:30.000Z',
        },
      ],
      policy,
      now,
    );
    expect(inactive).toMatchObject({
      active: false,
      reason: 'not-enough-distinct-messages',
      distinctMessageCount: 1,
    });
    expect(inactive.ignoredMessageIds).toEqual(expect.arrayContaining(['old', 'repeat-2']));
  });

  it('suppresses already commented chat themes but permits genuinely new discussions', () => {
    const history = [
      {
        chat_fingerprint: 'v1:energiepreise|netzausbau|kosten',
        chat_theme: 'Energiepreise und Netzausbau',
        text: 'Im Chat werden die Kosten des Netzausbaus diskutiert.',
      },
    ];

    expect(isRepeatedChatDiscussion('v1:energiepreise|netzausbau|kosten', null, history)).toBe(true);
    expect(isRepeatedChatDiscussion('v1:netzausbau|kosten|haushalte', null, history)).toBe(true);
    expect(isRepeatedChatDiscussion('v1:bildung|schulen|lehrer', 'Bildung und Schulen', history)).toBe(false);
  });
});
