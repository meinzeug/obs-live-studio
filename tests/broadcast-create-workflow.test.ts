import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('broadcast create workflow', () => {
  it('keeps modal fields mounted and focuses the created show in the timeline', async () => {
    const page = await readFile('apps/web/src/pages/BroadcastPage.tsx', 'utf8');

    expect(page).toContain('{DraftFields()}');
    expect(page).toContain('{ContentPicker()}');
    expect(page).toContain('const [creatingPlaylist, setCreatingPlaylist] = useState(false)');
    expect(page).toContain('setCreatedPlaylistFocusId(result.playlist.id)');
    expect(page).toContain('id={`broadcast-timeline-${playlist.id}`}');
    expect(page).toContain("creatingPlaylist ? 'Sendung wird erstellt …' : 'Sendung erstellen'");
  });

  it('offers KI Studio Runde as its own card instead of silently selecting AVA only', async () => {
    const page = await readFile('apps/web/src/pages/BroadcastPage.tsx', 'utf8');
    const api = await readFile('apps/api/src/index.ts', 'utf8');

    expect(page).toContain('KI Studio Runde');
    expect(page).toContain('KI-Runde mit sechs Personen aktivieren');
    expect(page).toContain('aiRoundtable: event.target.checked');
    expect(page).toContain(
      "aiRoundtable: format.content_mode === 'ai-roundtable' || format.settings?.aiRoundtable === true",
    );
    expect(api).toContain('settings.aiRoundtable === true || contextFormatSettings.aiRoundtable === true');
  });
});
