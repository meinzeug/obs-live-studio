import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ttsEnvironmentForAiPresenter } from '../apps/api/src/tts-generation.js';

describe('YouTube context presenters', () => {
  it('gives the chat moderator a distinct official Pocket TTS voice', () => {
    const base = {
      TTS_ENGINE: 'pocket-tts',
      TTS_DEFAULT_VOICE: 'anna',
      POCKET_TTS_LANGUAGE: 'german_24l',
    };

    expect(ttsEnvironmentForAiPresenter('moderator', base).TTS_DEFAULT_VOICE).toBe('anna');
    expect(ttsEnvironmentForAiPresenter('chat-moderator', base).TTS_DEFAULT_VOICE).toBe('vera');
    expect(ttsEnvironmentForAiPresenter('chat-analyst', base).TTS_DEFAULT_VOICE).toBe('vera');
    expect(
      ttsEnvironmentForAiPresenter('chat-moderator', {
        ...base,
        AI_CHAT_MODERATOR_TTS_VOICE: 'vera',
      }).TTS_DEFAULT_VOICE,
    ).toBe('vera');
  });

  it('does not pass a Pocket catalogue voice to a deliberately selected Piper provider', () => {
    const piper = {
      TTS_ENGINE: 'piper',
      TTS_DEFAULT_VOICE: 'de_DE-dii-high',
      AI_CHAT_MODERATOR_TTS_VOICE: 'alba',
    };
    expect(ttsEnvironmentForAiPresenter('chat-moderator', piper).TTS_DEFAULT_VOICE).toBe('de_DE-dii-high');
    const thorsten = ttsEnvironmentForAiPresenter('chat-moderator', piper, 'de_DE-thorsten-high');
    expect(thorsten.TTS_DEFAULT_VOICE).toBe('de_DE-thorsten-high');
    expect(thorsten.PIPER_MODEL_PATH).toBe('./var/models/piper/de_DE-thorsten-high.onnx');
  });

  it('persists separate presenter voices and idle/speaking uploads for the settings UI', async () => {
    const [migration, voiceMigration, routes, settingsUi] = await Promise.all([
      readFile('packages/database/src/028_presenter_media_and_context_timing.sql', 'utf8'),
      readFile('packages/database/src/030_pocket_tts_voice_catalog.sql', 'utf8'),
      readFile('apps/api/src/ai-presenter-media.ts', 'utf8'),
      readFile('apps/web/src/components/AgentPresenterSettings.tsx', 'utf8'),
    ]);
    expect(migration).toContain('create table if not exists ai_presenter_profiles');
    expect(migration).toContain('create table if not exists ai_presenter_media');
    expect(routes).toContain("'/api/ai-presenters/:memberId/media/:state'");
    expect(routes).toContain("'libvpx-vp9'");
    expect(routes).toContain("{ id: 'anna', label: 'Anna · weiblich · German 24L HQ' }");
    expect(routes).toContain("{ id: 'alba', label: 'Alba · männlich/tief · German 24L' }");
    expect(voiceMigration).toContain("values ('030_pocket_tts_voice_catalog')");
    expect(voiceMigration).toContain("set tts_voice='anna'");
    expect(voiceMigration).toContain('on conflict(key) do nothing');
    expect(settingsUi).toContain('TTS-Stimme in allen Sendungen');
    expect(settingsUi).toContain('Greenscreen freistellen');
  });

  it('keeps AVA visible, shows mod2 only for chat turns and serializes on-air audio', async () => {
    const api = await readFile('apps/api/src/index.ts', 'utf8');
    expect(api).toContain('youtube-context-ava-video');
    expect(api).toContain('youtube-context-chat-video');
    expect(api).toContain('turn?.kind==="chat-response"');
    expect(api).toContain('activeHostAudio.pause()');
    expect(api).toContain('HOST_DUCK_LEAD_MS=650');
    expect(api).toContain('requestVideoFrameCallback(frameReady)');
    expect(api).toContain('audio.addEventListener("playing"');
    expect(api).toContain('youtube-context-ava-speaking-video');
    expect(api).toContain('setContextSpeakingVideo(youtubeContextStage');
    expect(api).toContain('audioActive&&!contextChat');
    expect(api).toContain('turn?.presenterId==="chat-moderator"');
    expect(api).toContain('preparing-chat .youtube-context-ava-video{visibility:hidden;opacity:0}');
    expect(api).toContain('contextChat,chatSpeaking');
    expect(api).toContain('video.pause();try{video.currentTime=0}catch{}video.play()');
    expect(api).toContain('pendingHostAudioTurn===turn.id&&revealedHostAudioTurns.has(turn.id)');
    expect(api).toContain('host.chatModerator?.videoUrl||host.moderator?.chatModeratorVideoUrl');
    expect(api).toContain('displayHost?.chatModerator?.name||"MIA"');
    expect(api).toContain('displayHost?.chatModerator?.jobTitle||"KI-Chatmoderatorin"');
  });

  it('takes AVA and Mia full-screen over the station film before speech and returns after YouTube resumes', async () => {
    const api = await readFile('apps/api/src/index.ts', 'utf8');
    expect(api).toContain('.studio-brand-background.youtube-context.presenter-takeover');
    expect(api).toContain('.youtube-context-stage.presenter-takeover');
    expect(api).toContain('contextBrandTakeoverIn');
    expect(api).toContain('contextTakeoverOut');
    expect(api).toContain('beginContextTakeover(turn,host)');
    expect(api).toContain('contextTakeoverSnapshot={turn,host}');
    expect(api).toContain('HOST_VIDEO_RESUME_LEAD_MS=800');
    expect(api).toContain('HOST_TAKEOVER_EXIT_MS=650');
    expect(api).toContain('setContextTakeoverPhase(turn.id,"returning")');
    expect(api).toContain('setTimeout(finalize,HOST_VIDEO_RESUME_LEAD_MS+HOST_TAKEOVER_EXIT_MS)');
    expect(api).toContain('contextTakeoverPhase==="returning"?"VIDEO STARTET":"VIDEO PAUSIERT"');
    expect(api).toContain('.youtube-context-stage.presenter-takeover.chat-speaking .youtube-context-ava-video');
    expect(api).toContain('.youtube-context-stage.presenter-takeover.chat-speaking .youtube-context-chat-video');

    expect(api).toContain('beginContextTakeover(turn,host);if(lastYoutubeContextState)renderYoutubeContext');
    expect(api).toContain(
      'await duck("start");await new Promise(resolve=>setTimeout(resolve,HOST_DUCK_LEAD_MS));audio.play()',
    );
    expect(api).toContain(
      'duck("stop").finally(()=>{if(hadTakeover)contextTakeoverExitTimer=setTimeout(finalize,HOST_VIDEO_RESUME_LEAD_MS+HOST_TAKEOVER_EXIT_MS)',
    );
  });

  it('models the chat presenter as a separate recoverable on-air agent', async () => {
    const [migration, preferencesMigration, runtime, database, settingsUi] = await Promise.all([
      readFile('packages/database/src/027_chat_moderator_agent.sql', 'utf8'),
      readFile('packages/database/src/032_ai_presenter_live_preferences.sql', 'utf8'),
      readFile('apps/api/src/ai-tv-team.ts', 'utf8'),
      readFile('packages/database/src/ai-staff.ts', 'utf8'),
      readFile('apps/web/src/components/AiTeamPanel.tsx', 'utf8'),
    ]);
    expect(migration).toContain("'chat-moderator'");
    expect(migration).toContain("'Mia'");
    expect(runtime).toContain("getAiStaffMember('chat-moderator')");
    expect(runtime).toContain('nextAiStaffVoiceTurn(session.id)');
    expect(runtime).toContain('voiceQueueTail');
    expect(database).toContain('pg_advisory_xact_lock');
    expect(database).toContain("max(ends_at)+interval '700 milliseconds'");
    expect(database).toContain('markAiStaffTurnPlaybackStarted');
    expect(database).toContain('completeAiStaffTurnPlayback');
    expect(preferencesMigration).toContain("'liveFrequency','active'");
    expect(preferencesMigration).toContain("'contextDepth','detailed'");
    expect(runtime).toContain('presenterIntervalSeconds');
    expect(settingsUi).toContain('Einordnungsfrequenz');
    expect(settingsUi).toContain('Chatreaktionsfrequenz');
  });

  it('persists and exposes Sams activity-aware three-minute handoff to Mia', async () => {
    const [migration, runtime, database, settingsUi] = await Promise.all([
      readFile('packages/database/src/034_proactive_chat_commentary.sql', 'utf8'),
      readFile('apps/api/src/ai-tv-team.ts', 'utf8'),
      readFile('packages/database/src/ai-staff.ts', 'utf8'),
      readFile('apps/web/src/components/AiTeamPanel.tsx', 'utf8'),
    ]);

    expect(migration).toContain("'chatAnalysisIntervalSeconds',180");
    expect(migration).toContain("'chatCommentaryIntervalSeconds',180");
    expect(migration).toContain("'chatMinimumDistinctMessages',3");
    expect(migration).toContain("'chatMinimumUniqueAuthors',2");
    expect(migration).toContain("'chat-commentary'");
    expect(runtime).toContain('analyzeChatActivity(activityMessages, discussionPolicy)');
    expect(runtime).toContain("'live_chat_handoff_to_moderator'");
    expect(database).toContain('recentAiChatCommentaries');
    expect(database).toContain('chat_fingerprint');
    expect(settingsUi).toContain('Sams Chat-Radar');
    expect(settingsUi).toContain('Periodisches Chat-Lagebild');
    expect(settingsUi).toContain('Chat von selbst kommentieren');
  });
});
