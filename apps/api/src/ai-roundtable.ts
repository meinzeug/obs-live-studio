import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WritePermission } from '@ans/security/auth';
import type { ObsController } from '@ans/obs-controller';
import { runAiStaffAssignment } from '@ans/ai-provider';
import { getPlaybackSnapshot, getYoutubeContextPlaybackControl, setYoutubeContextPlaybackPaused } from '@ans/database';
import {
  completeExpiredAiRoundtableTurns,
  currentAiRoundtableTurn,
  getAiRoundtableSettings,
  insertAiRoundtableTurn,
  listAiRoundtableParticipants,
  listAiRoundtableTurns,
  nextRoundtableAudienceQuestion,
  recentRoundtableAudienceMessages,
  resetAiRoundtableTurns,
  updateAiRoundtableSettings,
  type AiRoundtablePreset,
  type AiRoundtableVideoContext,
} from '@ans/database/ai-roundtable';
import { recordAiStaffActivity } from '@ans/database/ai-staff';
import {
  claimYoutubePreproducedCue,
  completeYoutubePreproducedCue,
  type YoutubePreproducedCue,
} from '@ans/database/youtube-preproduction';
import { resolveOperationalNotification, upsertOperationalNotification } from '@ans/database/notifications';
import { z } from 'zod';
import { generateTtsAudio, ttsEnvironmentForAiPresenter } from './tts-generation.js';

type RequirePermission = (request: FastifyRequest, reply: FastifyReply, permission: WritePermission) => unknown;
type ReadStoredFile = (path: string) => Promise<Buffer>;
type UpdateEmitter = (reason: string, payload?: Record<string, unknown>) => Promise<void>;

const presetCopy: Record<AiRoundtablePreset, { title: string; kicker: string; accent: string; instructions: string }> =
  {
    'studio-rundtisch': {
      title: 'KI STUDIO RUNDE',
      kicker: 'SECHS PERSPEKTIVEN · EIN THEMA',
      accent: '#22d3ee',
      instructions:
        'Führe eine verständliche Fernsehdiskussion. Beziehe dich konkret auf vorherige Positionen, vermeide Wiederholungen und formuliere einen klaren Gedanken pro Wortmeldung.',
    },
    'fakten-duell': {
      title: 'FAKTEN-DUELL',
      kicker: 'BEHAUPTUNG · GEGENCHECK · EINORDNUNG',
      accent: '#f59e0b',
      instructions:
        'Prüfe die zentrale Behauptung. Trenne belegte Information, plausible Interpretation und offene Frage. Keine Quelle oder Zahl erfinden.',
    },
    publikumsforum: {
      title: 'PUBLIKUMSFORUM KI',
      kicker: 'YOUTUBE + TWITCH LIVE IN DER RUNDE',
      accent: '#a78bfa',
      instructions:
        'Greife einen echten Zuschauerimpuls auf, nenne den Nutzernamen respektvoll und beantworte den Kern verständlich. Behaupte nie, der Chat sei sich einig.',
    },
  };

const settingsInput = z
  .object({
    preset: z.enum(['studio-rundtisch', 'fakten-duell', 'publikumsforum']).optional(),
    topic: z.string().trim().min(8).max(600).optional(),
    moderatorId: z.string().trim().min(1).max(80).optional(),
    participantIds: z
      .array(z.string().trim().min(1).max(80))
      .min(2)
      .max(6)
      .transform((values) => [...new Set(values)])
      .optional(),
    turnDurationSeconds: z.number().int().min(12).max(180).optional(),
    maxRounds: z.number().int().min(1).max(12).optional(),
    chatEnabled: z.boolean().optional(),
    factCheckEnabled: z.boolean().optional(),
    audiencePrompt: z.string().trim().min(4).max(300).optional(),
    productionSettings: z
      .object({
        introductionsEnabled: z.boolean().optional(),
        showAllParticipants: z.boolean().optional(),
        autoDiscussVideos: z.boolean().optional(),
        videoLayout: z.enum(['video-left', 'panel-grid']).optional(),
        fallbackMode: z.literal('local-editorial').optional(),
        minimumParticipants: z.number().int().min(2).max(6).optional(),
        humorLevel: z.enum(['off', 'subtle', 'lively']).optional(),
        banterEnabled: z.boolean().optional(),
        duckYoutubeAudio: z.boolean().optional(),
        youtubeDuckVolume: z.number().min(0).max(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

function boundedCopy(value: unknown, maximum = 900) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function isUsableSpokenCopy(value: string) {
  const normalized = value.trim();
  if (normalized.length < 40) return false;
  return ![
    /^\.{2,}$/,
    /\bkein(?:e|en|er|es)?\s+(?:json|objekt|schema|zusammenfassung)\b/i,
    /\b(?:json|schema)[- ]?(?:objekt|antwort|ausgabe)\b/i,
    /\bals ki\b/i,
    /\bich kann (?:diese|die) (?:anfrage|aufgabe) nicht\b/i,
  ].some((pattern) => pattern.test(normalized));
}

function humorIsSensitive(...values: unknown[]) {
  return /\b(?:anschlag|attentat|terror|krieg|tot(?:e|er|es)?|tödlich|ermord|opfer|gewalt|missbrauch|vergewalt|suizid|unfall|katastroph|schwer verletzt|krankheit|trauer)\b/i.test(
    values.map((value) => boundedCopy(value, 500)).join(' '),
  );
}

function localHumorLine(speakerId: string, turnIndex: number) {
  const lines: Record<string, string[]> = {
    moderator: [
      'Große Behauptung, kleiner Belegzettel – da fehlt noch etwas im Bild.',
      'Das klingt schon sehr sendefertig; die Beleglage ist offenbar noch in der Maske.',
    ],
    'chat-moderator': [
      'Bauchgefühl hat heute übrigens keinen Presseausweis.',
      'Der Chat darf gern mitprüfen – Schwarmintelligenz ist schließlich günstiger als ein Untersuchungsausschuss.',
    ],
    'presenter-lea': [
      'Wenn die Pointe schneller ist als die Quelle, drücke ich kurz auf Faktenpause.',
      'Die Aussage trägt schon Abendgarderobe, der Beleg sucht noch seine Schuhe.',
    ],
    'presenter-leon': [
      'Politisch klingt das bereits beschlossen; beim Beleg steht noch „wird geladen“.',
      'Das ist eine steile These – immerhin spart sie beim Treppenhaus.',
    ],
    'presenter-jonas': [
      'Die Rechnung klingt beeindruckend – bis jemand nach den Zahlen fragt.',
      'Ökonomisch nennt man das bislang eine Prognose mit sehr selbstbewusstem Auftreten.',
    ],
    'presenter-karim': [
      'Im Publikum nennt man das eine steile These; im Studio suchen wir noch das Geländer.',
      'Für Applaus reicht der Satz vielleicht – für Gewissheit brauchen wir noch einen Beleg.',
    ],
  };
  const choices = lines[speakerId] ?? [
    'Die Aussage ist pointiert; jetzt fehlt nur noch der Teil mit dem überprüfbaren Beleg.',
  ];
  return choices[Math.abs(turnIndex) % choices.length]!;
}

function withDeadline<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} hat nach ${Math.ceil(milliseconds / 1_000)} Sekunden nicht geantwortet.`)),
      milliseconds,
    );
    timer.unref?.();
  });
  return Promise.race([promise, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function localTurn(input: {
  speaker: { id: string; display_name: string; job_title: string };
  topic: string;
  preset: AiRoundtablePreset;
  kind: 'opening' | 'position' | 'response' | 'fact-check' | 'audience' | 'closing';
  videoContext: AiRoundtableVideoContext;
  previous: Array<{ display_name?: string; text: string }>;
  audience: Array<{ author_name: string; message: string }>;
  productionSettings: {
    humorLevel?: 'off' | 'subtle' | 'lively';
    banterEnabled?: boolean;
  };
  turnIndex: number;
}) {
  const previous = input.previous[0];
  const audience = input.audience.at(-1);
  const evidence = input.videoContext.cards?.find((card) => card.text || card.headline);
  const news = input.videoContext.news?.find((item) => item.text || item.title);
  const evidenceText = boundedCopy(evidence?.text || evidence?.headline || news?.text || news?.title, 360);
  const evidenceSource = boundedCopy(evidence?.sourceLabel || news?.source || input.videoContext.channel, 120);
  const humorAllowed =
    input.productionSettings.banterEnabled !== false &&
    input.productionSettings.humorLevel !== 'off' &&
    (input.productionSettings.humorLevel === 'lively' || input.turnIndex % 3 === 0) &&
    !humorIsSensitive(input.topic, evidenceText, previous?.text);
  const humor = humorAllowed ? ` ${localHumorLine(input.speaker.id, input.turnIndex)}` : '';
  if (input.kind === 'opening' || input.kind === 'position') {
    const introductionFocus: Record<string, string> = {
      moderator:
        'Ich halte die Gesprächsfäden zusammen und stoppe uns, wenn Behauptung und Beleg durcheinandergeraten.',
      'presenter-leon': 'Ich schaue auf politische Verantwortung, Interessen und die Folgen einer Entscheidung.',
      'presenter-lea': 'Ich prüfe Behauptungen, Quellen und das, was im Material ausdrücklich offenbleibt.',
      'presenter-jonas': 'Ich achte auf Kosten, Anreize und die praktischen Auswirkungen hinter den Schlagworten.',
      'chat-moderator': 'Ich bringe eure Fragen und Gegenpositionen aus dem Chat direkt in unsere Runde.',
      'presenter-karim':
        'Ich frage, was die Debatte im Alltag bedeutet und ob die Beispiele wirklich verallgemeinerbar sind.',
    };
    return {
      headline: `${input.speaker.display_name} stellt sich vor`,
      text: `Ich bin ${input.speaker.display_name}, ${input.speaker.job_title}. ${introductionFocus[input.speaker.id] ?? 'Ich ergänze die Runde mit einer eigenen, überprüfbaren Perspektive.'}${input.kind === 'opening' && evidenceText ? ` Zum Einstieg steht diese Aussage im Raum: ${evidenceText}${evidenceSource ? ` Quelle: ${evidenceSource}.` : ''}` : ''}`,
      prompt: '',
    };
  }
  if (input.preset === 'publikumsforum' && audience) {
    return {
      headline: `Impuls von ${boundedCopy(audience.author_name, 60)}`,
      text: `${boundedCopy(audience.author_name, 60)} schreibt: „${boundedCopy(audience.message, 260)}“ Diesen Punkt nehme ich direkt auf.${humor} Entscheidend ist, welche überprüfbare Information die Position stützt und welche konkrete Folge sich daraus ergibt.`,
      prompt: 'Welche Erfahrung oder Quelle ergänzt diesen Punkt?',
    };
  }
  if (input.preset === 'fakten-duell') {
    return {
      headline: `${input.speaker.display_name} prüft die Beleglage`,
      text: `${previous ? `${previous.display_name ?? 'Die vorherige Wortmeldung'} hat den Streitpunkt benannt. ` : ''}Jetzt müssen Behauptung, Quelle und Schlussfolgerung getrennt werden. Ohne einen konkreten Beleg bleibt die Aussage zunächst eine offene These und kein gesicherter Befund.`,
      prompt: 'Welche konkrete Quelle sollen wir als Nächstes prüfen?',
    };
  }
  return {
    headline: `${input.speaker.display_name}s Perspektive`,
    text: previous
      ? `${evidenceText ? `Der zentrale Punkt aus dem vorliegenden Material lautet: ${evidenceText}${evidenceSource ? ` Quelle: ${evidenceSource}.` : ''}` : `Ein wichtiger Gedanke aus der bisherigen Runde lautet: ${boundedCopy(previous.text, 260)}`}${humor} Entscheidend ist, welche Folge daraus tatsächlich ableitbar ist und was weiterhin offenbleibt.`
      : `Für mich ist jetzt der Kern:${evidenceText ? ` ${evidenceText}${evidenceSource ? ` Quelle: ${evidenceSource}.` : ''}` : ' Wir müssen Aussage, Beleg, Gegenposition und konkrete Folge sauber voneinander trennen.'}${humor}`,
    prompt: 'Welche Perspektive fehlt euch noch in der Runde?',
  };
}

export class AiRoundtableRuntime {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private lastError: string | null = null;

  constructor(private readonly emitUpdate: UpdateEmitter = async () => undefined) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 750);
    this.timer.unref?.();
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async notify(reason: string, payload: Record<string, unknown> = {}) {
    await this.emitUpdate(reason, payload);
  }

  async snapshot() {
    const settings = await getAiRoundtableSettings();
    const [allParticipants, selectedParticipants, turn, turns, audience] = await Promise.all([
      listAiRoundtableParticipants(),
      listAiRoundtableParticipants(settings.participant_ids),
      currentAiRoundtableTurn(),
      listAiRoundtableTurns(24),
      settings.chat_enabled ? recentRoundtableAudienceMessages(18) : Promise.resolve([]),
    ]);
    const participantView = (participant: (typeof allParticipants)[number]) => ({
      ...participant,
      idleVideoUrl: participant.idle_revision
        ? `/api/overlay/ai-presenters/${encodeURIComponent(participant.id)}/idle?v=${encodeURIComponent(participant.idle_revision)}`
        : null,
      speakingVideoUrl: participant.speaking_revision
        ? `/api/overlay/ai-presenters/${encodeURIComponent(participant.id)}/speaking?v=${encodeURIComponent(participant.speaking_revision)}`
        : null,
    });
    const design = presetCopy[settings.preset];
    return {
      settings,
      design,
      participants: selectedParticipants.map(participantView),
      availableParticipants: allParticipants.map(participantView),
      turn: turn
        ? {
            ...turn,
            audioUrl: turn.audio_path ? `/api/overlay/ai-roundtable/turns/${encodeURIComponent(turn.id)}/audio` : null,
          }
        : null,
      turns,
      audience,
      runtime: { running: Boolean(this.timer), busy: this.busy, lastError: this.lastError },
      serverTime: new Date().toISOString(),
    };
  }

  async tick(force = false) {
    if (this.busy) return;
    this.busy = true;
    try {
      const settings = await getAiRoundtableSettings();
      if (settings.status !== 'live') return;
      if (settings.active_item_id && settings.show_session_key && !settings.show_session_key.startsWith('manual:')) {
        const playback = await getPlaybackSnapshot();
        if (playback.playlistId && playback.playlistId !== settings.show_session_key) {
          await completeExpiredAiRoundtableTurns();
          await updateAiRoundtableSettings({ status: 'ended', currentSpeakerId: null });
          await this.emitUpdate('roundtable-session-ended', {
            reason: 'program-changed',
            previousPlaylistId: settings.show_session_key,
            currentPlaylistId: playback.playlistId,
          });
          return;
        }
      }
      await completeExpiredAiRoundtableTurns();
      if (!force && (await currentAiRoundtableTurn())) return;
      const participants = await listAiRoundtableParticipants(settings.participant_ids);
      if (participants.length < 2)
        throw new Error('Für die Diskussionsrunde sind mindestens zwei aktive Moderatoren nötig.');
      const scriptedVideoMode = Boolean(
        settings.introduction_complete &&
        settings.production_settings?.autoDiscussVideos !== false &&
        settings.video_context?.youtubeLibraryId &&
        settings.video_context?.runKey &&
        settings.active_item_id,
      );
      const maximumTurns = participants.length * settings.max_rounds;
      if (settings.current_turn_index >= maximumTurns && !scriptedVideoMode) {
        await updateAiRoundtableSettings({
          status: 'ended',
          currentSpeakerId: null,
        });
        await this.emitUpdate('roundtable-ended');
        return;
      }
      const turnIndex = settings.current_turn_index + 1;
      const audienceQuestion =
        scriptedVideoMode &&
        settings.chat_enabled &&
        settings.current_turn_index >= participants.length &&
        settings.current_turn_index % 5 === 0
          ? await nextRoundtableAudienceQuestion().catch(() => null)
          : null;
      let preparedCue: YoutubePreproducedCue | null = null;
      if (scriptedVideoMode && !audienceQuestion) {
        const control = await getYoutubeContextPlaybackControl(settings.active_item_id!).catch(() => null);
        if (control?.last_progress_at && Date.now() - Date.parse(control.last_progress_at) < 20_000) {
          preparedCue = await claimYoutubePreproducedCue({
            youtubeVideoId: settings.video_context.youtubeLibraryId!,
            runKey: settings.video_context.runKey!,
            broadcastItemId: settings.active_item_id,
            mediaPositionMs: Number(control.media_position_ms ?? 0),
          }).catch(() => null);
          if (preparedCue) await setYoutubeContextPlaybackPaused(settings.active_item_id!, true);
        }
      }
      if (audienceQuestion && settings.active_item_id)
        await setYoutubeContextPlaybackPaused(settings.active_item_id, true);
      const roundNumber = scriptedVideoMode
        ? Math.min(settings.max_rounds, Math.max(1, Math.ceil(turnIndex / participants.length)))
        : Math.ceil(turnIndex / participants.length);
      const speaker = audienceQuestion
        ? (participants.find((participant) => participant.id === 'chat-moderator') ??
          participants.find((participant) => participant.id === settings.moderator_id) ??
          participants[0]!)
        : preparedCue
          ? (participants.find((participant) => participant.id === preparedCue.presenter_id) ??
            participants[(turnIndex - 1) % participants.length]!)
          : turnIndex === 1
            ? (participants.find((participant) => participant.id === settings.moderator_id) ?? participants[0]!)
            : participants[(turnIndex - 1) % participants.length]!;
      const [previous, audience] = await Promise.all([
        listAiRoundtableTurns(8),
        settings.chat_enabled ? recentRoundtableAudienceMessages(12) : Promise.resolve([]),
      ]);
      const design = presetCopy[settings.preset];
      const introductionsEnabled = settings.production_settings?.introductionsEnabled !== false;
      const introductionTurn =
        introductionsEnabled && !settings.introduction_complete && turnIndex <= participants.length;
      if (scriptedVideoMode && !preparedCue && !audienceQuestion && !audience.length) return;
      const kind = audienceQuestion
        ? 'audience'
        : introductionTurn && turnIndex === 1
          ? 'opening'
          : introductionTurn
            ? 'position'
            : settings.preset === 'publikumsforum' && audience.length
              ? 'audience'
              : settings.preset === 'fakten-duell' && settings.fact_check_enabled && turnIndex % 3 === 0
                ? 'fact-check'
                : 'response';
      const fallback = localTurn({
        speaker,
        topic: settings.topic,
        preset: settings.preset,
        kind,
        videoContext: settings.video_context ?? {},
        previous,
        audience,
        productionSettings: settings.production_settings ?? {},
        turnIndex,
      });
      const turnMode = [
        'konkretisieren',
        'freundlich widersprechen',
        'nachfragen',
        'pointieren',
        'Publikum einbeziehen',
      ][(turnIndex - 1) % 5]!;
      const humorAllowed =
        settings.production_settings?.banterEnabled !== false &&
        settings.production_settings?.humorLevel !== 'off' &&
        !humorIsSensitive(
          settings.topic,
          settings.video_context?.title,
          settings.video_context?.cards?.map((card) => card.text).join(' '),
        );
      let headline = fallback.headline;
      let text = fallback.text;
      let audiencePrompt = fallback.prompt;
      let model = 'lokale-redaktionsregie';
      let tier: 'free' | 'paid' | 'codex' | 'local' = 'local';
      if (audienceQuestion) {
        headline = `Frage von ${boundedCopy(audienceQuestion.author_name, 80)}`;
        text = `${boundedCopy(audienceQuestion.author_name, 80)} fragt: „${boundedCopy(
          audienceQuestion.message,
          520,
        )}“ Was sagt der Chat dazu?`;
        audiencePrompt = '';
        model = 'live-chat-regie';
        tier = 'local';
      } else if (preparedCue) {
        headline = preparedCue.headline;
        text = preparedCue.speaker_text;
        audiencePrompt = preparedCue.audience_prompt ?? '';
        model = 'vorproduzierte-transkript-regie';
        tier = 'local';
      } else if (!preparedCue)
        try {
          const result = await withDeadline(
            runAiStaffAssignment({
              memberName: speaker.display_name,
              jobTitle: speaker.job_title,
              role: speaker.role,
              description: speaker.description,
              standingInstructions: `${speaker.instructions}\n${design.instructions}`,
              configuration: speaker.config,
              taskKind: 'assignment',
              title: `${design.title}: Wortmeldung ${turnIndex}`,
              instructions: [
                `Thema: ${settings.topic}`,
                `Runde: ${roundNumber} von ${settings.max_rounds}`,
                `Wortmeldung: ${turnIndex}`,
                `Dramaturgische Aufgabe dieser Wortmeldung: ${turnMode}. Reagiere auf eine konkrete Aussage aus Video, Quellenpaket, Chat oder vorheriger Wortmeldung.`,
                introductionTurn
                  ? `Vorstellungsrunde: Stelle dich als ${speaker.display_name}, ${speaker.job_title}, in einem Satz vor und nenne danach deine konkrete Perspektive auf das Thema.`
                  : 'Diskussionsphase: Ordne eine konkrete Aussage des aktuellen Videos ein und knüpfe nachvollziehbar an die Runde an.',
                `Aktuelles Video- und Quellenpaket: ${JSON.stringify(settings.video_context ?? {})}`,
                `Vorherige Aussagen: ${JSON.stringify(previous.slice(0, 5).map((turn) => ({ speaker: turn.display_name, text: turn.text })))}`,
                settings.chat_enabled
                  ? `Aktuelle sichere Zuschauerimpulse: ${JSON.stringify(audience.slice(-8))}`
                  : 'Zuschauerimpulse sind für diese Runde deaktiviert.',
                `Sprich konsequent in der Ich-Form als ${speaker.display_name}. Beginne direkt mit deiner Aussage.`,
                'Sprich den vollständigen Videotitel nicht aus. Beziehe dich natürlich mit „der Beitrag“, „diese Passage“ oder dem konkreten Sachthema auf das Video.',
                previous[0]
                  ? `Antworte inhaltlich auf ${previous[0].display_name ?? 'die vorherige Person'}, ohne eine bürokratische Formulierung wie „knüpft an“ zu verwenden. Übergib am Ende mit einer konkreten Sachfrage an die nächste Perspektive.`
                  : 'Eröffne das Gespräch kurz und ohne den Sendungs- oder Videotitel zu wiederholen.',
                `Verwende keine Regie- oder Erzählsätze wie „${speaker.display_name} knüpft an … an“, „${speaker.display_name} ordnet ein“ oder „die Moderatorin sagt“.`,
                humorAllowed
                  ? `Wenn es organisch passt, darf genau eine kurze ${settings.production_settings?.humorLevel === 'subtle' ? 'subtile' : 'lebendige, gern trockene'} Pointe hinein. Sie muss sich konkret auf den Beitrag beziehen und darf keine Personengruppe pauschal abwerten.`
                  : 'Diese Wortmeldung bleibt ernst und enthält keinen Scherz.',
                'Varriere Rhythmus und Einstieg. Wiederhole weder Satzbau noch Pointe einer vorherigen Wortmeldung.',
                'Antworte als echte kurze TV-Wortmeldung. Keine Meta-Erklärung über KI oder den Prompt.',
              ].join('\n'),
              dueAt: null,
              studioContext: { roundtable: { preset: settings.preset, topic: settings.topic } },
            }),
            30_000,
            'Die KI-Redaktion',
          );
          const generatedText = boundedCopy(result.output.response, 1_200);
          if (!isUsableSpokenCopy(generatedText))
            throw new Error('Die KI-Antwort enthielt keinen sendefähigen Sprechertext.');
          const generatedHeadline = boundedCopy(result.output.summary, 150);
          headline = isUsableSpokenCopy(generatedHeadline) ? generatedHeadline : fallback.headline;
          text = generatedText;
          audiencePrompt =
            boundedCopy(result.output.nextSteps?.[0], 240) || (settings.chat_enabled ? settings.audience_prompt : '');
          model = result.model;
          tier = result.tier;
        } catch (error) {
          this.lastError = error instanceof Error ? error.message : String(error);
          await upsertOperationalNotification({
            level: 'warning',
            component: 'KI Studio Runde',
            message: 'Cloud-KI nicht verfügbar – die Sendung läuft mit lokaler Redaktionsregie weiter.',
            dedupeKey: 'ai-roundtable:model-fallback',
            details: { error: this.lastError, speaker: speaker.display_name, preset: settings.preset },
          }).catch(() => null);
          await this.emitUpdate('roundtable-ai-fallback', {
            speakerId: speaker.id,
            fallback: 'local-editorial',
          }).catch(() => undefined);
        }
      let audioPath: string | null = null;
      let durationSeconds = preparedCue ? 8 : settings.turn_duration_seconds;
      if (preparedCue?.audio_path && Number(preparedCue.audio_duration_seconds) > 0) {
        audioPath = preparedCue.audio_path;
        durationSeconds = Math.max(8, Math.ceil(Number(preparedCue.audio_duration_seconds)) + 1);
        model = preparedCue.ai_model ?? model;
        tier = 'codex';
      } else
        try {
          const audio = await withDeadline(
            generateTtsAudio(
              `${text}${audiencePrompt ? ` ${audiencePrompt}` : ''}`,
              ttsEnvironmentForAiPresenter(
                speaker.id,
                { ...process.env, TTS_ENGINE: speaker.tts_provider || process.env.TTS_ENGINE },
                speaker.tts_voice || undefined,
              ),
            ),
            60_000,
            'Die Sprachsynthese',
          );
          audioPath = audio.file;
          durationSeconds = Math.max(durationSeconds, Math.ceil(audio.durationSeconds) + 2);
        } catch (error) {
          this.lastError = error instanceof Error ? error.message : String(error);
          await upsertOperationalNotification({
            level: 'warning',
            component: 'KI Studio Runde',
            message: 'Eine Wortmeldung konnte nicht vertont werden; Text und Sendungsablauf laufen weiter.',
            dedupeKey: 'ai-roundtable:tts-fallback',
            details: { error: this.lastError, speaker: speaker.display_name },
          }).catch(() => null);
        }
      if ((preparedCue || audienceQuestion) && !audioPath) {
        if (preparedCue && settings.video_context.runKey)
          await completeYoutubePreproducedCue(preparedCue.id, settings.video_context.runKey, 'failed').catch(
            () => null,
          );
        if (settings.active_item_id)
          await setYoutubeContextPlaybackPaused(settings.active_item_id, false).catch(() => null);
        await this.emitUpdate('roundtable-cue-skipped', {
          cueId: preparedCue?.id ?? null,
          audienceMessageId: audienceQuestion?.id ?? null,
          reason: 'tts-unavailable',
        }).catch(() => undefined);
        return;
      }
      const turn = await insertAiRoundtableTurn({
        speakerId: speaker.id,
        turnIndex,
        roundNumber,
        kind,
        headline,
        text,
        audiencePrompt: settings.chat_enabled ? audiencePrompt : null,
        sourceLabels: audienceQuestion
          ? [`${audienceQuestion.provider}: ${audienceQuestion.author_name}`]
          : audience.slice(-3).map((message) => `${message.provider}: ${message.author_name}`),
        model,
        tier,
        audioPath,
        preproducedCueId: preparedCue?.id ?? null,
        preproducedRunKey: preparedCue ? settings.video_context.runKey : null,
        videoPauseMs: preparedCue == null ? null : Number(preparedCue.at_ms),
        sourceStartMs: preparedCue?.source_start_ms == null ? null : Number(preparedCue.source_start_ms),
        sourceEndMs: preparedCue?.source_end_ms == null ? null : Number(preparedCue.source_end_ms),
        audienceMessageId: audienceQuestion?.id ?? null,
        durationSeconds,
      });
      await recordAiStaffActivity({
        staffMemberId: speaker.id,
        eventType: 'roundtable_turn_live',
        title: `${design.title} · Wortmeldung ${turnIndex}`,
        detail: text,
        status: 'on_air',
        metadata: {
          preset: settings.preset,
          topic: settings.topic,
          roundNumber,
          turnId: turn.id,
          model,
          tier,
          audienceMessages: audience.length,
          preproducedCueId: preparedCue?.id ?? null,
          sourceExcerpt: preparedCue?.source_excerpt ?? null,
          audienceMessageId: audienceQuestion?.id ?? null,
        },
      }).catch(() => null);
      if (introductionTurn && turnIndex >= participants.length)
        await updateAiRoundtableSettings({ introductionComplete: true });
      if (tier !== 'local') {
        this.lastError = null;
        await resolveOperationalNotification('ai-roundtable:model-fallback').catch(() => null);
      }
      if (audioPath) await resolveOperationalNotification('ai-roundtable:tts-fallback').catch(() => null);
      await this.emitUpdate('roundtable-turn', { turnId: turn.id, speakerId: speaker.id, turnIndex });
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      await updateAiRoundtableSettings({ status: 'error' }).catch(() => null);
      await this.emitUpdate('roundtable-error', { error: this.lastError }).catch(() => undefined);
    } finally {
      this.busy = false;
    }
  }
}

export function aiRoundtableOverlayHtml() {
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>KI Studio Runde</title>
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:Inter,Arial,sans-serif;color:#f8fafc}
#studio{position:relative;width:1920px;height:1080px;overflow:hidden;background:transparent}
header{position:absolute;left:36px;right:36px;top:26px;height:126px;display:flex;align-items:center;justify-content:space-between;padding:18px 25px;border:1px solid color-mix(in srgb,var(--accent) 58%,rgba(255,255,255,.12));border-radius:23px;background:linear-gradient(110deg,rgba(2,6,14,.97),rgba(8,18,34,.94));box-shadow:0 18px 48px rgba(0,0,0,.42);z-index:10}
.kicker{color:var(--accent);font-size:15px;font-weight:950;letter-spacing:.16em}.title{margin-top:5px;font-size:42px;font-weight:1000;letter-spacing:-.035em}.video-meta{max-width:820px;text-align:right}.topic{font-size:22px;font-weight:850;line-height:1.15}.video-source{margin-top:8px;color:#94a3b8;font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.phase{display:inline-flex;margin-top:7px;padding:6px 10px;border-radius:999px;background:color-mix(in srgb,var(--accent) 18%,rgba(2,6,23,.9));color:var(--accent);font-size:12px;font-weight:950;letter-spacing:.08em}
.video-frame{position:absolute;left:36px;top:172px;width:1212px;height:698px;border:3px solid color-mix(in srgb,var(--accent) 72%,rgba(255,255,255,.2));border-radius:25px;box-shadow:inset 0 0 0 8px rgba(2,6,23,.28),0 22px 58px rgba(0,0,0,.42);pointer-events:none}
.video-frame:before{content:"AKTUELLES VIDEO";position:absolute;left:18px;top:16px;padding:7px 11px;border-radius:999px;background:rgba(2,6,23,.84);color:var(--accent);font-size:12px;font-weight:950;letter-spacing:.09em}
.grid{position:absolute;left:1272px;right:36px;top:172px;height:698px;display:grid;grid-template-columns:repeat(2,1fr);grid-template-rows:repeat(3,1fr);gap:12px}
.person{position:relative;overflow:hidden;border:2px solid rgba(148,163,184,.24);border-radius:19px;background:linear-gradient(150deg,rgba(15,23,42,.98),rgba(3,7,18,.96));box-shadow:0 14px 34px rgba(0,0,0,.38);transition:.42s}
.person.speaking{z-index:4;border-color:var(--person-accent);transform:scale(1.035);box-shadow:0 0 0 3px color-mix(in srgb,var(--person-accent) 25%,transparent),0 20px 45px rgba(0,0,0,.58)}
.person video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 24%;background:transparent}
.placeholder{position:absolute;inset:0;display:grid;place-items:center;background:radial-gradient(circle,color-mix(in srgb,var(--person-accent) 20%,#111827),#030712)}
.placeholder strong{display:grid;place-items:center;width:72px;height:72px;border:2px solid var(--person-accent);border-radius:50%;font-size:26px;box-shadow:0 0 35px color-mix(in srgb,var(--person-accent) 35%,transparent)}
.person-meta{position:absolute;left:0;right:0;bottom:0;padding:36px 12px 10px;background:linear-gradient(transparent,rgba(1,4,10,.99))}
.person-meta strong{display:block;font-size:19px}.person-meta span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#cbd5e1;font-size:11px;font-weight:750}.live-dot{display:none;position:absolute;right:9px;top:9px;padding:5px 8px;border-radius:999px;background:var(--person-accent);color:#020617;font-size:9px;font-weight:1000}.speaking .live-dot{display:block;animation:pulse 1s ease infinite}
.lower{position:absolute;left:36px;right:36px;bottom:24px;height:164px;display:grid;grid-template-columns:1fr 590px;gap:18px}
.turn,.audience{border:1px solid color-mix(in srgb,var(--accent) 48%,rgba(255,255,255,.12));border-radius:21px;background:rgba(3,7,18,.95);overflow:hidden;box-shadow:0 18px 44px rgba(0,0,0,.35)}
.turn{padding:16px 22px;border-left:8px solid var(--accent);opacity:0;transform:translateY(18px);visibility:hidden;transition:opacity .28s ease,transform .28s ease,visibility .28s}.turn.active{opacity:1;transform:translateY(0);visibility:visible}.turn small{color:var(--accent);font-weight:950;letter-spacing:.12em}.turn h2{margin:5px 0 4px;font-size:25px}.turn p{margin:0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;color:#dbeafe;font-size:17px;font-weight:670;line-height:1.22}
.audience{padding:14px 17px}.audience h3{margin:0 0 7px;color:var(--accent);font-size:15px}.chat{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:4px 0;color:#dbeafe;font-size:13px}.chat strong{color:#fff}.empty{color:#64748b}.status{position:absolute;right:52px;top:133px;padding:6px 10px;border-radius:999px;background:#0f172a;color:#94a3b8;font-size:11px;font-weight:900;z-index:12}
@keyframes pulse{50%{filter:brightness(1.55)}}@keyframes enter{from{opacity:0;transform:translateY(12px)}}
</style></head><body><main id="studio"><header><div><div class="kicker"></div><div class="title"></div><div class="phase"></div></div><div class="video-meta"><div class="topic"></div><div class="video-source"></div></div></header><div class="video-frame"></div><section class="grid"></section><section class="lower"><article class="turn"><small></small><h2></h2><p></p></article><aside class="audience"><h3>LIVE-PUBLIKUM · YOUTUBE + TWITCH</h3><div class="chat-list"></div></aside></section><div class="status"></div></main>
<script>
const studio=document.querySelector("#studio"),grid=document.querySelector(".grid"),audio=new Audio(),audioClientId="roundtable-"+(crypto.randomUUID?.()||Math.random().toString(36).slice(2));let activeTurn="",activeDuckTurn="",activeDuckItem="";
function initials(name){return String(name||"?").split(/\\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase()}
function fit(){const s=Math.min(innerWidth/1920,innerHeight/1080);studio.style.transform="scale("+s+")";studio.style.transformOrigin="0 0"}addEventListener("resize",fit);fit();
function setVideo(card,url,mode,playing=false){let video=card.querySelector("video");if(!url){video?.remove();card.querySelector(".placeholder").style.display="grid";return null}card.querySelector(".placeholder").style.display="none";if(!video){video=document.createElement("video");video.muted=true;video.loop=true;video.playsInline=true;video.autoplay=false;card.prepend(video)}if(video.dataset.url!==url){video.dataset.url=url;video.src=url;video.load()}if(mode==="idle"||playing)video.play().catch(()=>{});else{video.pause();try{video.currentTime=0}catch{}}return video}
async function duck(action,turnId=activeDuckTurn,itemId=activeDuckItem,volume){if(!turnId||!itemId)return false;try{const response=await fetch("/api/overlay/audio-duck",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,turnId,itemId,clientId:audioClientId,...(Number.isFinite(volume)?{volume}: {})}),keepalive:true});return response.ok}catch{return false}}
async function releaseDuck(){const turnId=activeDuckTurn,itemId=activeDuckItem;activeDuckTurn="";activeDuckItem="";if(turnId&&itemId)return duck("stop",turnId,itemId);return true}
async function finishTurn(){const speaking=grid.querySelector(".person.speaking");if(speaking){speaking.classList.remove("speaking");setVideo(speaking,speaking.dataset.idleUrl||"","idle",true)}audio.pause();await releaseDuck();await load()}
audio.addEventListener("ended",()=>void finishTurn());audio.addEventListener("error",()=>void finishTurn());
async function load(){try{const r=await fetch("/api/overlay/ai-roundtable",{cache:"no-store"});if(!r.ok)return;const d=await r.json(),turn=d.turn,video=d.settings.video_context||{},channel=String(video.channel||"YouTube").replace(/\\s*@\\s*YouTube$/i,"");studio.style.setProperty("--accent",d.design.accent);document.querySelector(".kicker").textContent=d.design.kicker;document.querySelector(".title").textContent=d.design.title;document.querySelector(".topic").textContent=video.title||d.settings.topic;document.querySelector(".video-source").textContent=(channel||"YouTube")+" @ YouTube"+(video.url?" · "+video.url:"");document.querySelector(".phase").textContent=d.settings.introduction_complete?"VIDEO · ANALYSE · DISKUSSION":"LIVE-VORSTELLUNGSRUNDE";document.querySelector(".status").textContent=d.settings.status.toUpperCase()+" · RUNDE "+(turn?.round_number||1)+"/"+d.settings.max_rounds;
const known=new Map([...grid.children].map(x=>[x.dataset.id,x]));for(const p of d.participants){let card=known.get(p.id);if(!card){card=document.createElement("article");card.className="person";card.dataset.id=p.id;card.innerHTML='<div class="placeholder"><strong></strong></div><div class="live-dot">SPRICHT</div><div class="person-meta"><strong></strong><span></span></div>';grid.append(card)}known.delete(p.id);card.style.setProperty("--person-accent",p.accent_color);card.dataset.idleUrl=p.idleVideoUrl||"";card.querySelector(".placeholder strong").textContent=initials(p.display_name);card.querySelector(".person-meta strong").textContent=p.display_name;card.querySelector(".person-meta span").textContent=p.job_title;const speaking=turn?.speaker_id===p.id;card.classList.toggle("speaking",speaking);setVideo(card,speaking?(p.speakingVideoUrl||p.idleVideoUrl):p.idleVideoUrl,speaking?"speaking":"idle",Boolean(speaking&&turn?.id===activeTurn&&!audio.paused&&!audio.ended))}for(const card of known.values())card.remove();
const box=document.querySelector(".turn");box.classList.toggle("active",Boolean(turn));box.querySelector("small").textContent=turn?(turn.display_name+" · "+turn.kind).toUpperCase():"";box.querySelector("h2").textContent=turn?.headline||"";box.querySelector("p").textContent=[turn?.text,turn?.audience_prompt].filter(Boolean).join(" · ");
const list=document.querySelector(".chat-list");list.replaceChildren();for(const msg of d.audience.slice(-4)){const line=document.createElement("div");line.className="chat";const strong=document.createElement("strong");strong.textContent=msg.author_name+": ";line.append(strong,document.createTextNode(msg.message));list.append(line)}if(!list.children.length){const empty=document.createElement("div");empty.className="empty";empty.textContent="Neue Nachrichten aus YouTube und Twitch erscheinen hier.";list.append(empty)}
if(d.settings.status!=="live"){audio.pause();await releaseDuck()}else if(turn?.id&&turn.id!==activeTurn){await releaseDuck();activeTurn=turn.id;audio.pause();audio.src=turn.audioUrl||"";if(turn.audioUrl){const card=grid.querySelector('[data-id="'+CSS.escape(turn.speaker_id)+'"]'),video=card?.querySelector("video"),start=async()=>{if(d.settings.production_settings?.duckYoutubeAudio!==false&&d.settings.active_item_id){activeDuckTurn=turn.id;activeDuckItem=d.settings.active_item_id;await duck("start",turn.id,d.settings.active_item_id,Number(d.settings.production_settings?.youtubeDuckVolume??.22))}try{if(video){video.currentTime=0;await video.play()}await audio.play()}catch{await finishTurn()}};if(video&&video.readyState<3)video.addEventListener("canplay",()=>void start(),{once:true});else await start()}}else if(!turn){audio.pause();await releaseDuck()}else if(turn?.id===activeTurn&&audio.src&&audio.paused&&!audio.ended){const card=grid.querySelector('[data-id="'+CSS.escape(turn.speaker_id)+'"]'),video=card?.querySelector("video");try{if(video)await video.play();await audio.play()}catch{await finishTurn()}}}catch(e){console.error(e)}}
setInterval(load,500);load();
addEventListener("pagehide",()=>{if(!activeDuckTurn||!activeDuckItem)return;const body=JSON.stringify({action:"stop",turnId:activeDuckTurn,itemId:activeDuckItem,clientId:audioClientId});try{navigator.sendBeacon("/api/overlay/audio-duck",new Blob([body],{type:"application/json"}))}catch{}});
</script></body></html>`;
}

export function registerAiRoundtableRoutes(
  app: FastifyInstance,
  requirePermission: RequirePermission,
  runtime: AiRoundtableRuntime,
  obs: ObsController,
  readStoredFile: ReadStoredFile,
) {
  app.get('/api/ai-roundtable', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    return runtime.snapshot();
  });
  app.patch('/api/ai-roundtable', async (request, reply) => {
    requirePermission(request, reply, 'broadcast:write');
    const input = settingsInput.parse(request.body ?? {});
    if (input.participantIds) {
      const available = await listAiRoundtableParticipants(input.participantIds);
      if (available.length !== input.participantIds.length)
        return reply.code(409).send({ error: 'Mindestens ein gewählter On-Air-Agent ist nicht aktiv.' });
      if (input.moderatorId && !input.participantIds.includes(input.moderatorId))
        return reply.code(400).send({ error: 'Die Gesprächsleitung muss Teil der Runde sein.' });
    }
    await updateAiRoundtableSettings(input);
    await runtime.tick();
    return runtime.snapshot();
  });
  app.post('/api/ai-roundtable/start', async (request, reply) => {
    requirePermission(request, reply, 'obs:write');
    const input = settingsInput.extend({ takeProgram: z.boolean().default(false) }).parse(request.body ?? {});
    await updateAiRoundtableSettings({
      ...input,
      status: 'preparing',
      showSessionKey: `manual:${Date.now()}`,
      activeItemId: null,
      introductionComplete: input.productionSettings?.introductionsEnabled === false,
      videoContext: {},
    });
    await resetAiRoundtableTurns();
    await updateAiRoundtableSettings({ status: 'live', startedAt: new Date().toISOString() });
    await obs.ensureBrowserOverlay({
      template: 'ai-roundtable',
      url: `${process.env.PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://127.0.0.1:12000'}/overlay/ai-roundtable`,
      width: 1920,
      height: 1080,
    });
    if (input.takeProgram) await obs.setScene('21_AI_ROUNDTABLE');
    await runtime.tick(true);
    await runtime.notify('roundtable-started', { takeProgram: input.takeProgram }).catch(() => undefined);
    return runtime.snapshot();
  });
  app.post('/api/ai-roundtable/:action', async (request, reply) => {
    requirePermission(request, reply, 'obs:write');
    const action = z.enum(['pause', 'resume', 'next', 'stop', 'take']).parse((request.params as any).action);
    if (action === 'pause') await updateAiRoundtableSettings({ status: 'paused' });
    if (action === 'resume') await updateAiRoundtableSettings({ status: 'live' });
    if (action === 'next') {
      await completeExpiredAiRoundtableTurns();
      await runtime.tick(true);
    }
    if (action === 'stop') {
      await updateAiRoundtableSettings({ status: 'ended', currentSpeakerId: null });
      await completeExpiredAiRoundtableTurns();
    }
    if (action === 'take') {
      await obs.ensureBrowserOverlay({
        template: 'ai-roundtable',
        url: `${process.env.PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://127.0.0.1:12000'}/overlay/ai-roundtable`,
        width: 1920,
        height: 1080,
      });
      await obs.setScene('21_AI_ROUNDTABLE');
    }
    return runtime.snapshot();
  });
  app.get('/api/ai-roundtable/overlay', async () => runtime.snapshot());
  app.get('/api/overlay/ai-roundtable', async () => runtime.snapshot());
  app.get('/overlay/ai-roundtable', async (_request, reply) => reply.type('text/html').send(aiRoundtableOverlayHtml()));
  app.get('/api/ai-roundtable/turns/:id/audio', async (request, reply) => {
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: unknown }).id);
    const turn = (await listAiRoundtableTurns(200)).find((entry) => entry.id === id);
    if (!turn?.audio_path) return reply.code(404).send({ error: 'Audio ist nicht verfügbar.' });
    return reply
      .header('Cache-Control', 'no-store')
      .type('audio/wav')
      .send(await readStoredFile(turn.audio_path));
  });
  app.get('/api/overlay/ai-roundtable/turns/:id/audio', async (request, reply) => {
    const id = z
      .string()
      .uuid()
      .parse((request.params as { id?: unknown }).id);
    const turn = (await listAiRoundtableTurns(200)).find((entry) => entry.id === id);
    if (!turn?.audio_path) return reply.code(404).send({ error: 'Audio ist nicht verfügbar.' });
    return reply
      .header('Cache-Control', 'no-store')
      .type('audio/wav')
      .send(await readStoredFile(turn.audio_path));
  });
}
