export type LiveDirectorAction = 'ava-takeover' | 'ava-inline' | 'mia-interaction';

export type LiveDirectorDecision = {
  action: LiveDirectorAction;
  trigger: 'editorial-moment' | 'chat-activity' | 'audience-window' | 'closing' | 'silence-limit';
  presenterId: 'moderator' | 'chat-moderator';
  displayMode: 'takeover' | 'inline';
  priority: number;
  reason: string;
  pauseIndex: number | null;
  nextCheckSeconds: number;
  signals: Record<string, unknown>;
};

export type LiveDirectorInput = {
  nowMs: number;
  sessionStartedAtMs: number;
  nextDirectionAtMs: number;
  progressPercent: number | null;
  progressFresh: boolean;
  liveSource: boolean;
  pendingChatMessages: number;
  pendingChatQuestions: number;
  lastChatMessageAtMs: number;
  sequence: number;
  pauseIndex: number;
  pauseMoments: Array<{ atPercent: number }>;
  lastAvaAtMs: number;
  lastMiaAtMs: number;
  closingPrompted: boolean;
  avaTargetIntervalSeconds: number;
  minimumAvaCommentariesPerHour: number;
  miaPromptIntervalSeconds: number;
  inlineCommentaryEnabled: boolean;
  takeoverFrequency: 'rare' | 'balanced' | 'frequent';
};

function boundedSeconds(value: number, fallback: number, minimum: number, maximum: number) {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.round(value))) : fallback;
}

function elapsedSeconds(nowMs: number, atMs: number) {
  return Math.max(0, (nowMs - Math.max(0, atMs)) / 1000);
}

export function directLiveShow(input: LiveDirectorInput): LiveDirectorDecision | null {
  const minimumCadence = input.minimumAvaCommentariesPerHour > 0 ? 3600 / input.minimumAvaCommentariesPerHour : 600;
  const baseAvaInterval = Math.min(
    boundedSeconds(input.avaTargetIntervalSeconds, 420, 90, 900),
    boundedSeconds(minimumCadence, 600, 90, 900),
  );
  const avaInterval = Math.round(baseAvaInterval * (input.liveSource ? 0.72 : 1));
  const miaInterval = boundedSeconds(input.miaPromptIntervalSeconds, 480, 150, 1200);
  const sinceAva = elapsedSeconds(input.nowMs, input.lastAvaAtMs || input.sessionStartedAtMs);
  const sinceMia = elapsedSeconds(input.nowMs, input.lastMiaAtMs || input.sessionStartedAtMs);
  const recentChat = input.lastChatMessageAtMs > 0 && input.nowMs - input.lastChatMessageAtMs <= 150_000;
  const nextPause = input.pauseMoments[input.pauseIndex];
  const pauseDue =
    Boolean(nextPause) &&
    input.progressFresh &&
    input.progressPercent !== null &&
    input.progressPercent >= Math.max(5, Math.min(95, Number(nextPause?.atPercent) || 0));

  if (pauseDue) {
    return {
      action: 'ava-takeover',
      trigger: 'editorial-moment',
      presenterId: 'moderator',
      displayMode: 'takeover',
      priority: 95,
      reason: `Der redaktionelle Marker bei ${Math.round(Number(nextPause?.atPercent) || 0)} Prozent wurde erreicht.`,
      pauseIndex: input.pauseIndex,
      nextCheckSeconds: Math.max(45, Math.round(avaInterval * 0.6)),
      signals: {
        progressPercent: input.progressPercent,
        pauseIndex: input.pauseIndex,
        liveSource: input.liveSource,
      },
    };
  }

  if (
    input.pendingChatQuestions === 0 &&
    input.pendingChatMessages >= 2 &&
    recentChat &&
    sinceMia >= Math.min(miaInterval, 240)
  ) {
    return {
      action: 'mia-interaction',
      trigger: 'chat-activity',
      presenterId: 'chat-moderator',
      displayMode: 'inline',
      priority: 86,
      reason: `${input.pendingChatMessages} neue Chatbeiträge bilden ein aktives Publikumsfenster.`,
      pauseIndex: null,
      nextCheckSeconds: Math.max(90, Math.round(miaInterval * 0.55)),
      signals: {
        pendingChatMessages: input.pendingChatMessages,
        recentChat,
        sinceMiaSeconds: Math.round(sinceMia),
      },
    };
  }

  if (input.progressPercent !== null && input.progressPercent >= 88 && !input.closingPrompted && sinceMia >= 90) {
    return {
      action: 'mia-interaction',
      trigger: 'closing',
      presenterId: 'chat-moderator',
      displayMode: 'inline',
      priority: 82,
      reason: 'Das Video nähert sich dem Ende; Mia öffnet ein letztes Publikumsfenster.',
      pauseIndex: null,
      nextCheckSeconds: 180,
      signals: { progressPercent: input.progressPercent, closingPrompted: false },
    };
  }

  if (sinceMia >= miaInterval && input.nowMs >= input.nextDirectionAtMs) {
    return {
      action: 'mia-interaction',
      trigger: 'audience-window',
      presenterId: 'chat-moderator',
      displayMode: 'inline',
      priority: 70,
      reason: `Seit ${Math.round(sinceMia)} Sekunden gab es kein Publikumsfenster.`,
      pauseIndex: null,
      nextCheckSeconds: Math.max(120, Math.round(miaInterval * 0.75)),
      signals: { sinceMiaSeconds: Math.round(sinceMia), miaIntervalSeconds: miaInterval },
    };
  }

  if (sinceAva >= avaInterval && input.nowMs >= input.nextDirectionAtMs) {
    const takeover =
      input.takeoverFrequency === 'frequent' ||
      (input.takeoverFrequency === 'balanced' && input.sequence % 3 === 0) ||
      !input.inlineCommentaryEnabled;
    return {
      action: takeover ? 'ava-takeover' : 'ava-inline',
      trigger: 'silence-limit',
      presenterId: 'moderator',
      displayMode: takeover ? 'takeover' : 'inline',
      priority: input.liveSource ? 78 : 74,
      reason: `AVA war seit ${Math.round(sinceAva)} Sekunden nicht in der laufenden Einordnung.`,
      pauseIndex: null,
      nextCheckSeconds: Math.max(60, Math.round(avaInterval * 0.8)),
      signals: {
        sinceAvaSeconds: Math.round(sinceAva),
        avaIntervalSeconds: avaInterval,
        liveSource: input.liveSource,
      },
    };
  }

  return null;
}
