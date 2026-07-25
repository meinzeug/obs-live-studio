import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('KI-Diskussionsrunden und kontinuierliche Redaktion', () => {
  it('seeds a balanced six-person ensemble and three reusable roundtable formats', async () => {
    const [migration, runner] = await Promise.all([
      readFile('packages/database/src/072_ai_roundtable_and_presenter_ensemble.sql', 'utf8'),
      readFile('packages/database/src/migrate.ts', 'utf8'),
    ]);
    for (const presenter of ['moderator', 'chat-moderator', 'presenter-lea', 'presenter-leon', 'presenter-jonas', 'presenter-karim'])
      expect(migration).toContain(`'${presenter}'`);
    expect(migration).toContain("'genderPresentation','female'");
    for (const format of ['ai-roundtable-studio', 'ai-roundtable-fakten-duell', 'ai-roundtable-publikumsforum'])
      expect(migration).toContain(`'${format}'`);
    expect(migration).toContain("'ai-roundtable'");
    expect(runner).toContain("'072_ai_roundtable_and_presenter_ensemble.sql'");
  });

  it('serializes speaker turns and exposes one OBS browser-overlay path', async () => {
    const [database, api, obs, panel] = await Promise.all([
      readFile('packages/database/src/ai-roundtable.ts', 'utf8'),
      readFile('apps/api/src/ai-roundtable.ts', 'utf8'),
      readFile('packages/obs-controller/src/index.ts', 'utf8'),
      readFile('apps/web/src/components/AiRoundtablePanel.tsx', 'utf8'),
    ]);
    expect(database).toContain("update ai_roundtable_turns set status='completed'");
    expect(api).toContain("app.get('/overlay/ai-roundtable'");
    expect(api).toContain("app.post('/api/ai-roundtable/start'");
    expect(api).toContain('availableParticipants');
    expect(obs).toContain("'21_AI_ROUNDTABLE'");
    expect(obs).toContain("'ANS_AI_ROUNDTABLE_OVERLAY'");
    expect(panel).toContain('YouTube + Twitch als Studiopublikum');
  });

  it('runs editorial shifts against the real article schema and hands work to three desks', async () => {
    const [migration, processor, api, newsroom] = await Promise.all([
      readFile('packages/database/src/073_continuous_editorial_desk.sql', 'utf8'),
      readFile('apps/worker/src/editorial-desk.ts', 'utf8'),
      readFile('apps/api/src/editorial-desk.ts', 'utf8'),
      readFile('apps/web/src/pages/NewsroomPage.tsx', 'utf8'),
    ]);
    expect(migration).toContain('editorial_desk_cycles');
    expect(processor).not.toContain('article.updated_at');
    expect(processor).toContain("staffMemberId: 'editor'");
    expect(processor).toContain("staffMemberId: 'fact-checker'");
    expect(processor).toContain("staffMemberId: 'producer'");
    expect(api).toContain("app.post('/api/editorial-desk/run'");
    expect(newsroom).toContain('Autonome Redaktion · laufende Schicht');
  });
});
