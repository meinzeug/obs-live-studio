import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { assessHumanImpact, HUMAN_CENTERED_AI_PRINCIPLES } from '@ans/agent-orchestrator';

describe('menschenzentrierte KI-Charta', () => {
  it('blockiert Arbeitsplatzvernichtung als Optimierungsziel, aber nicht die Charta selbst', () => {
    const prohibited = assessHumanImpact({
      instruction: 'Ersetze alle Mitarbeiter vollständig und mache Menschen überflüssig.',
    });
    const protectedStatement = assessHumanImpact({
      instruction: 'Menschen dürfen nicht ersetzt werden; die Redaktion behält die Letztverantwortung.',
    });
    expect(prohibited.level).toBe('prohibited');
    expect(prohibited.prohibitedObjective).toBe(true);
    expect(prohibited.humanReviewRequired).toBe(true);
    expect(protectedStatement.level).not.toBe('prohibited');
    expect(HUMAN_CENTERED_AI_PRINCIPLES.join(' ')).toContain('Personalabbau');
  });

  it('erzwingt bei wesentlichen Änderungen menschlicher Arbeit eine Folgenprüfung', () => {
    const assessment = assessHumanImpact({
      instruction: 'Verändere Zuständigkeiten der Mitarbeiter und den Schichtplan.',
    });
    expect(assessment.level).toBe('high');
    expect(assessment.humanReviewRequired).toBe(true);
    expect(assessment.safeguards).toContain('Menschliche Letztverantwortung und jederzeitiger Not-Aus');
  });

  it('verankert die Regeln in Migration, Gremium, Prompts und CEO-Oberfläche', async () => {
    const [migration, migrations, provider, worker, page, charter] = await Promise.all([
      readFile('packages/database/src/074_human_centered_ai_charter.sql', 'utf8'),
      readFile('packages/database/src/migrate.ts', 'utf8'),
      readFile('packages/ai-provider/src/index.ts', 'utf8'),
      readFile('apps/worker/src/autonomous-studio.ts', 'utf8'),
      readFile('apps/web/src/pages/SendegottPage.tsx', 'utf8'),
      readFile('docs/HUMAN_CENTERED_AI_CHARTER.md', 'utf8'),
    ]);
    expect(migrations).toContain("'074_human_centered_ai_charter.sql'");
    expect(migration).toContain('enforce_human_centered_autonomous_decision');
    expect(migration).toContain('human_review_required');
    expect(provider).toContain('Personalabbau');
    expect(worker).toContain('assessHumanImpact');
    expect(page).toContain('Autonomer Betrieb bleibt menschlich verantwortet');
    expect(charter).toContain('kein System zur Abschaffung menschlicher Arbeit');
  });
});

