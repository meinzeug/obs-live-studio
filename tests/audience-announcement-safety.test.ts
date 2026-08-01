import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('audience announcement on-air safety', () => {
  it('airs only applied decisions and binds audience decisions to their source session', async () => {
    const database = await readFile('packages/database/src/autonomous-studio.ts', 'utf8');
    const claim = database.slice(
      database.indexOf('export async function claimAutonomousStudioAnnouncement'),
      database.indexOf('export async function releaseAutonomousStudioAnnouncement'),
    );

    expect(claim).toContain("decision.status<>'applied'");
    expect(claim).toContain("decision.status='applied'");
    expect(claim).toContain('input.session_id=$1');
    expect(claim).toContain('update ai_staff_turns turn');
    expect(claim).toContain("set status='rejected',ends_at=now()");
    expect(claim).toContain("set status='cancelled'");
  });

  it('does not create on-air copy for rejected or revision-needed audience proposals', async () => {
    const database = await readFile('packages/database/src/autonomous-studio.ts', 'utf8');

    expect(database).not.toContain('Publikumsimpuls benötigt Überarbeitung');
    expect(database).not.toContain('Publikumsvorschlag besteht die Schlussprüfung nicht');
    expect(database).not.toContain('Das KI-Sendergremium hat den Vorschlag aus dem Chat geprüft, aber noch nicht freigegeben.');
  });

  it('does not promote an ordinary reply to a studio prompt into a council suggestion', async () => {
    const runtime = await readFile('apps/api/src/ai-tv-team.ts', 'utf8');
    const promptReply = runtime.slice(
      runtime.indexOf("if (directInteractionKind === 'prompt-reply'"),
      runtime.indexOf('if (!directInteractionMessage && !options.allowPeriodicCommentary)'),
    );
    const database = await readFile('packages/database/src/autonomous-studio.ts', 'utf8');

    expect(promptReply).toContain("if (explicit && explicit.kind !== 'question')");
    expect(promptReply).not.toContain(": 'suggestion'");
    expect(database).toContain('if (!row.command)');
    expect(database).toContain("status: 'ignored' as const");
  });
});
