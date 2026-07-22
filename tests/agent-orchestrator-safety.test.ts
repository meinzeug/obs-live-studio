import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string) {
  return readFile(path, 'utf8');
}

describe('agent orchestrator safety contracts', () => {
  it('stores only token hashes and makes audit and memory access append-only', async () => {
    const migration = await source('packages/database/src/054_agent_orchestrator.sql');
    expect(migration).toContain('token_hash text not null unique');
    expect(migration).not.toMatch(/\btoken\s+text\b/);
    expect(migration).toContain('trg_agent_tool_audit_append_only');
    expect(migration).toContain('trg_agent_memory_access_append_only');
    expect(migration).toContain('freeze_started_agent_workflow_definition');
    expect(migration).toContain("mode text not null default 'stopped'");
    expect(migration).toContain('agent_orchestrator_broadcast_isolation_required');
    expect(migration).toContain("enabled = (mode <> 'stopped')");
    expect(migration).toContain("retrieval_version text not null default 'fts-simple-v1'");
  });

  it('keeps code, OBS, publishing, shell and secrets outside the worker capabilities', async () => {
    const worker = await source('apps/worker/src/agent-orchestrator.ts');
    expect(worker).not.toContain('@ans/obs-controller');
    expect(worker).not.toContain("from 'node:child_process'");
    expect(worker).not.toContain('writeFile(');
    expect(worker).not.toContain('exec(');
    expect(worker).toContain('broadcastContinues: true');
    expect(worker).toContain('consumeAgentCapabilityGrant');
    expect(worker).toContain('recordAgentToolAudit');
    expect(worker).toContain('agent_workflow_step_discarded');
    expect(worker).toContain("if (!completion || completion.status === 'blocked')");
    expect(worker).toContain('STALE_STEP_RECOVERY_INTERVAL_MS = 30_000');
    expect(worker).toContain('now - this.lastStaleRecoveryAt >= STALE_STEP_RECOVERY_INTERVAL_MS');
  });

  it('hands completed work to the existing council without direct application', async () => {
    const database = await source('packages/database/src/agent-orchestrator.ts');
    expect(database).toContain("'awaiting_council','high','pending'");
    expect(database).toContain('council-quorum');
    expect(database).toContain('two-independent-reviews');
    expect(database).toContain('proposal-only-no-code-execution');
    expect(database).not.toContain("status='applied'");
    expect(database).toContain("status='pending',attempts=0,error=null");
  });

  it('exposes a visible kill switch, workflows, memory and capability history to the CEO', async () => {
    const [page, component, api] = await Promise.all([
      source('apps/web/src/pages/SendegottPage.tsx'),
      source('apps/web/src/components/AgentOrchestratorPanel.tsx'),
      source('apps/api/src/agent-orchestrator.ts'),
    ]);
    expect(page).toContain('AgentOrchestratorPanel');
    expect(component).toContain('Agenten-Not-Aus');
    expect(component).toContain('Kontrolliert leerfahren');
    expect(component).toContain('Memory & RAG');
    expect(component).toContain('An Gremium übergeben');
    expect(api).toContain("'/api/agent-orchestrator/control'");
    expect(api).toContain("'/api/agent-orchestrator/workflows/:id/handoff'");
    expect(api).not.toContain("'agent_orchestrator_settings', 'global'");
    expect(api).toContain("scope: 'global'");
    expect(api).toContain('agentId: id');
  });

  it('guards yt-dlp while it is running instead of checking size only after completion', async () => {
    const [worker, routes, database] = await Promise.all([
      source('apps/worker/src/video-editor.ts'),
      source('apps/api/src/youtube-video-editor.ts'),
      source('packages/database/src/video-editor.ts'),
    ]);
    expect(worker).toContain('VIDEO_EDITOR_MIN_FREE_BYTES');
    expect(worker).toContain('downloadedBytes >= maximumBytes');
    expect(worker).toContain('isVideoEditorDownloadActive');
    expect(routes).toContain("'/api/youtube-video-editor/sources/:id/cancel-download'");
    expect(database).toContain("if (current.status === 'cancelled') return current");
  });
});
