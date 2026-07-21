import { beforeEach, describe, expect, it } from 'vitest';
import { query } from '../../packages/database/src/index.js';
import {
  claimNextAiStaffTask,
  completeAiStaffTask,
  createAiStaffTask,
  getAiStaffTask,
  listAiStaffActivity,
  transitionAiStaffTask,
} from '../../packages/database/src/ai-staff.js';

const integration = process.env.VITEST_INCLUDE_INTEGRATION === 'true' ? describe : describe.skip;

integration('AI staff workbench', () => {
  beforeEach(async () => {
    await query(`delete from ai_staff_tasks where title like 'Workbench integration %'`);
  });

  it('persists, claims, completes and approves a reviewable staff assignment with a full activity trail', async () => {
    const created = await createAiStaffTask({
      staffMemberId: 'editor',
      kind: 'review',
      title: 'Workbench integration article review',
      instructions: 'Prüfe Aufbau und Quellenhinweise.',
      priority: 'urgent',
    });
    expect(created).toMatchObject({ status: 'queued', staff_member_id: 'editor' });

    const claimed = await claimNextAiStaffTask();
    expect(claimed?.id).toBe(created?.id);
    expect(claimed?.status).toBe('running');

    const completed = await completeAiStaffTask(claimed!.id, {
      summary: 'Prüfung abgeschlossen.',
      response: 'Die Quellenhinweise müssen ergänzt werden.',
      result: { findings: ['Eine Primärquelle fehlt.'], nextSteps: ['Quelle ergänzen.'] },
      model: 'integration-model',
      waitingReview: true,
    });
    expect(completed?.status).toBe('waiting_review');

    const approved = await transitionAiStaffTask(claimed!.id, 'approve');
    expect(approved).toMatchObject({ transitioned: true, task: { status: 'completed' } });
    expect((await getAiStaffTask(claimed!.id))?.completed_at).toBeTruthy();

    const activity = await listAiStaffActivity('editor', 30);
    const createdActivity = activity.find(
      (entry) => entry.task_id === claimed!.id && entry.event_type === 'task_created',
    );
    expect(createdActivity).toMatchObject({
      detail: 'Prüfe Aufbau und Quellenhinweise.',
      metadata: {
        requestTitle: 'Workbench integration article review',
        request: 'Prüfe Aufbau und Quellenhinweise.',
        requestKind: 'review',
        priority: 'urgent',
      },
    });
    const taskEvents = activity.filter((entry) => entry.task_id === claimed!.id).map((entry) => entry.event_type);
    expect(taskEvents).toEqual(
      expect.arrayContaining(['task_created', 'task_started', 'task_review_requested', 'task_approved']),
    );
  });
});
