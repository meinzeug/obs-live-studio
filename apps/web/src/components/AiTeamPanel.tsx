import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Clock3,
  Eye,
  ExternalLink,
  FileCheck2,
  History,
  Inbox,
  ListChecks,
  LoaderCircle,
  MessageCircle,
  Mic2,
  Pause,
  Play,
  RefreshCw,
  RadioTower,
  RotateCcw,
  Save,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Users,
  Video,
  X,
  Zap,
} from 'lucide-react';
import { api } from '../api/client.js';

type MemberConfig = {
  tone: 'neutral' | 'warm' | 'analytical' | 'decisive';
  responseDetail: 'compact' | 'balanced' | 'detailed';
  modelStrategy: 'speed' | 'balanced' | 'quality';
  proactive: boolean;
  requiresSources: boolean;
  notifyOnCompletion: boolean;
  specialties: string[];
  liveFrequency: 'restrained' | 'balanced' | 'active';
  contextDepth: 'focused' | 'balanced' | 'detailed';
  chatAnalysisEnabled: boolean;
  chatAnalysisIntervalSeconds: number;
  chatActivityWindowSeconds: number;
  chatMinimumDistinctMessages: number;
  chatMinimumUniqueAuthors: number;
  chatDuplicateSuppressionMinutes: number;
  proactiveChatCommentary: boolean;
  chatCommentaryIntervalSeconds: number;
  chatCommentaryDurationSeconds: number;
};

type Member = {
  id: string;
  display_name: string;
  job_title: string;
  role: string;
  description: string;
  enabled: boolean;
  autonomy: 'suggest' | 'review' | 'auto';
  avatar_style: string;
  accent_color: string;
  instructions: string;
  config: Partial<MemberConfig>;
  work_status: 'paused' | 'working' | 'queued' | 'on_air' | 'ready';
  open_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  total_tasks: number;
  last_activity_at: string | null;
  current_task_title: string | null;
};

type StaffTask = {
  id: string;
  staff_member_id: string;
  parent_task_id: string | null;
  kind: 'assignment' | 'question' | 'review';
  title: string;
  instructions: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'queued' | 'running' | 'waiting_review' | 'completed' | 'failed' | 'cancelled';
  requested_by_name: string | null;
  due_at: string | null;
  result_summary: string | null;
  result_text: string | null;
  result: Record<string, unknown>;
  model: string | null;
  error: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
};

type StaffActivity = {
  id: string;
  task_id: string | null;
  event_type: string;
  title: string;
  detail: string | null;
  status: string | null;
  metadata: Record<string, unknown>;
  actor_name: string | null;
  created_at: string;
};

type TeamActivity = StaffActivity & {
  staff_member_id: string;
  display_name: string;
  job_title: string;
};

type Workspace = {
  member: Member;
  tasks: StaffTask[];
  activity: StaffActivity[];
  metrics: {
    total: number;
    open: number;
    completed: number;
    failed: number;
    turns: number;
    average_completion_seconds: number | null;
    last_activity_at: string | null;
  };
};

type Settings = {
  enabled: boolean;
  live_stream_url: string | null;
  live_chat_id: string | null;
  chat_source_mode: 'channel' | 'content';
  chat_platforms?: Array<'youtube' | 'twitch'>;
  twitch_channel: string | null;
  active_moderator_id: string;
  overlay_position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  overlay_scale: number;
  show_avatar: boolean;
  show_chat: boolean;
  anonymize_authors: boolean;
  voice_enabled: boolean;
  avatar_voice_sync: boolean;
  interaction_mode: 'off' | 'review' | 'auto-safe';
  question_interval_seconds: number;
  response_cooldown_seconds: number;
  response_duration_seconds: number;
  max_turns_per_hour: number;
  max_chat_messages_per_turn: number;
  minimum_chat_messages: number;
  participation_prompt: string;
};

type ProviderStatus = {
  selected: boolean;
  configured: boolean;
  connected?: boolean;
  connecting?: boolean;
  channel?: string | null;
  lastMessageAt?: string | null;
  lastSuccessAt?: string | null;
  received?: number;
  errors?: string[];
  error?: string | null;
};
type Status = {
  runtime: {
    running: boolean;
    busy: boolean;
    taskBusy: boolean;
    lastTickAt: string | null;
    lastError: string | null;
    lastTaskError: string | null;
    lastVoiceError?: string | null;
    voiceJobs?: number;
  };
  session: {
    id: string;
    video_title: string;
    channel_title: string;
    status: string;
    chat_error: string | null;
    chat_messages_received: number;
    chat_last_success_at: string | null;
    chat_last_message_at: string | null;
  } | null;
  chatQueue: {
    received_total: number;
    safe_total: number;
    pending_total: number;
    pending_questions: number;
    processed_total: number;
    rejected_total: number;
    last_received_at: string | null;
    last_processed_at: string | null;
  } | null;
  turn: { id: string; kind: string; headline: string; text: string; cta: string | null } | null;
  recentTurns: Array<{ id: string; kind: string; headline: string; text: string; status: string; created_at: string }>;
  chatConfigured: boolean;
  youtubeApiConfigured: boolean;
  chatProviders?: { youtube?: ProviderStatus; twitch?: ProviderStatus };
};

type MemberDraft = Pick<
  Member,
  | 'display_name'
  | 'job_title'
  | 'description'
  | 'enabled'
  | 'autonomy'
  | 'avatar_style'
  | 'accent_color'
  | 'instructions'
> & { config: MemberConfig };
type AssignmentDraft = {
  kind: StaffTask['kind'];
  title: string;
  instructions: string;
  priority: StaffTask['priority'];
  dueAt: string;
};
type AgentTab = 'workspace' | 'settings' | 'history';

const emptyAssignment: AssignmentDraft = {
  kind: 'assignment',
  title: '',
  instructions: '',
  priority: 'normal',
  dueAt: '',
};

const rolePrompts: Record<string, Array<{ label: string; title: string; instructions: string }>> = {
  producer: [
    {
      label: 'Nächste Stunde planen',
      title: 'Programmfluss der nächsten Stunde prüfen',
      instructions:
        'Analysiere den aktuellen Sendefluss und erstelle einen konkreten dramaturgischen Ablauf mit Risiken, Übergängen und Prioritäten.',
    },
    {
      label: 'Formatidee',
      title: 'Neues wiederkehrendes Sendeformat entwerfen',
      instructions:
        'Entwirf ein realistisch produzierbares Format für den Sender inklusive Ziel, Ablauf, Länge und benötigten Bausteinen.',
    },
  ],
  editor: [
    {
      label: 'Themenbriefing',
      title: 'Redaktionelles Themenbriefing erstellen',
      instructions:
        'Erstelle ein sachliches Briefing mit Nachrichtenkern, offenen Punkten und Vorschlägen für die weitere Recherche.',
    },
    {
      label: 'Sprechertext prüfen',
      title: 'Sprechertext redaktionell prüfen',
      instructions:
        'Prüfe den gelieferten beziehungsweise aktuellen Text auf Verständlichkeit, Vollständigkeit und unnötige Wertungen.',
    },
  ],
  'fact-checker': [
    {
      label: 'Behauptungen prüfen',
      title: 'Zentrale Behauptungen prüfen',
      instructions:
        'Liste überprüfbare Behauptungen, vorhandene Belege, fehlende Primärquellen und konkrete nächste Prüfschritte getrennt auf.',
    },
    {
      label: 'Risikocheck',
      title: 'Redaktionellen Risikocheck durchführen',
      instructions:
        'Prüfe Formulierungs-, Quellen- und Verwechslungsrisiken. Erfinde keine Gegenfakten und kennzeichne fehlende Belege konkret.',
    },
  ],
  'chat-analyst': [
    {
      label: 'Chat-Lagebild',
      title: 'Aktuelles Chat-Lagebild erstellen',
      instructions:
        'Bündele wiederkehrende Fragen und Sichtweisen plattformübergreifend. Ignoriere Spam, Angriffe und personenbezogene Daten.',
    },
    {
      label: 'Fragen vorbereiten',
      title: 'Interaktive Publikumsfragen vorbereiten',
      instructions: 'Formuliere offene, faire Fragen, die konkrete und begründete Chatantworten fördern.',
    },
  ],
  'chat-moderator': [
    {
      label: 'Antwort vorbereiten',
      title: 'Quellenbasierte Live-Antwort vorbereiten',
      instructions:
        'Formuliere aus dem vorhandenen Recherchepaket eine kurze natürliche Antwort. Sprich den Zuschauer namentlich an, kennzeichne Unsicherheiten und nenne die wichtigsten Quellen.',
    },
    {
      label: 'On-Air-Check',
      title: 'Einsatzbereitschaft für den Livechat prüfen',
      instructions:
        'Prüfe Stimme, Avatar, Quellenlage und Sprechsperre. Melde konkret, ob eine sichere Live-Antwort ausgestrahlt werden kann.',
    },
  ],
  moderator: [
    {
      label: 'Moderation vorbereiten',
      title: 'Nächste Moderation vorbereiten',
      instructions:
        'Erstelle eine kurze natürliche Anmoderation, zwei kritische offene Fragen und einen klaren Teilnahmeaufruf.',
    },
    {
      label: 'Statusbericht',
      title: 'Einsatzbereitschaft berichten',
      instructions:
        'Gib einen kurzen Statusbericht: Was kannst du aktuell übernehmen, welche Informationen fehlen und was wäre der sinnvollste nächste Einsatz?',
    },
  ],
};

function memberConfig(member: Member): MemberConfig {
  return {
    tone:
      member.config?.tone ??
      (member.role === 'moderator' || member.role === 'chat-moderator'
        ? 'warm'
        : member.role === 'fact-checker' || member.role === 'chat-analyst'
          ? 'analytical'
          : 'neutral'),
    responseDetail: member.config?.responseDetail ?? 'balanced',
    modelStrategy: member.config?.modelStrategy ?? 'balanced',
    proactive: member.config?.proactive ?? true,
    requiresSources:
      member.config?.requiresSources ?? ['editor', 'fact-checker', 'moderator', 'chat-moderator'].includes(member.role),
    notifyOnCompletion: member.config?.notifyOnCompletion ?? true,
    liveFrequency:
      member.config?.liveFrequency ??
      (member.role === 'moderator' || member.role === 'chat-moderator' ? 'active' : 'balanced'),
    contextDepth:
      member.config?.contextDepth ??
      (member.role === 'moderator' ? 'detailed' : member.role === 'chat-moderator' ? 'balanced' : 'balanced'),
    chatAnalysisEnabled: member.config?.chatAnalysisEnabled ?? true,
    chatAnalysisIntervalSeconds: member.config?.chatAnalysisIntervalSeconds ?? 180,
    chatActivityWindowSeconds: member.config?.chatActivityWindowSeconds ?? 360,
    chatMinimumDistinctMessages: member.config?.chatMinimumDistinctMessages ?? 3,
    chatMinimumUniqueAuthors: member.config?.chatMinimumUniqueAuthors ?? 2,
    chatDuplicateSuppressionMinutes: member.config?.chatDuplicateSuppressionMinutes ?? 30,
    proactiveChatCommentary: member.config?.proactiveChatCommentary ?? true,
    chatCommentaryIntervalSeconds: member.config?.chatCommentaryIntervalSeconds ?? 180,
    chatCommentaryDurationSeconds: member.config?.chatCommentaryDurationSeconds ?? 20,
    specialties: Array.isArray(member.config?.specialties)
      ? member.config.specialties.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

function memberDraft(member: Member): MemberDraft {
  return {
    display_name: member.display_name,
    job_title: member.job_title,
    description: member.description,
    enabled: member.enabled,
    autonomy: member.autonomy,
    avatar_style: member.avatar_style,
    accent_color: member.accent_color,
    instructions: member.instructions,
    config: memberConfig(member),
  };
}

function roleIcon(role: string, size = 20) {
  if (role === 'moderator' || role === 'chat-moderator') return <Mic2 size={size} />;
  if (role === 'producer') return <Zap size={size} />;
  if (role === 'chat-analyst') return <MessageCircle size={size} />;
  if (role === 'fact-checker') return <ShieldCheck size={size} />;
  return <Sparkles size={size} />;
}

const workStatusLabel: Record<Member['work_status'], string> = {
  paused: 'Pausiert',
  working: 'Bearbeitet Auftrag',
  queued: 'Aufträge warten',
  on_air: 'Im Overlay',
  ready: 'Einsatzbereit',
};
const taskStatusLabel: Record<StaffTask['status'], string> = {
  queued: 'Eingeplant',
  running: 'In Arbeit',
  waiting_review: 'Freigabe nötig',
  completed: 'Erledigt',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
};
const priorityLabel: Record<StaffTask['priority'], string> = {
  low: 'Niedrig',
  normal: 'Normal',
  high: 'Hoch',
  urgent: 'Dringend',
};

function formatDate(value: string | null | undefined) {
  if (!value) return 'Noch keine Aktivität';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(parsed);
}

function relativeDate(value: string | null | undefined) {
  if (!value) return 'noch nie';
  const seconds = Math.round((Date.parse(value) - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  const [amount, unit]: [number, Intl.RelativeTimeFormatUnit] =
    absolute < 60
      ? [seconds, 'second']
      : absolute < 3600
        ? [Math.round(seconds / 60), 'minute']
        : absolute < 86_400
          ? [Math.round(seconds / 3600), 'hour']
          : [Math.round(seconds / 86_400), 'day'];
  return new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' }).format(amount, unit);
}

function resultList(task: StaffTask, key: 'findings' | 'nextSteps') {
  const value = task.result?.[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function activityResearchSources(entry: StaffActivity) {
  const sources = entry.metadata?.sources;
  if (!Array.isArray(sources)) return [];
  return sources
    .map((source) => {
      if (!source || typeof source !== 'object') return null;
      const record = source as Record<string, unknown>;
      const title = typeof record.title === 'string' ? record.title : '';
      const publisher = typeof record.publisher === 'string' ? record.publisher : '';
      const url = typeof record.url === 'string' ? record.url : '';
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol) || !title) return null;
      } catch {
        return null;
      }
      return { title, publisher, url };
    })
    .filter((source): source is { title: string; publisher: string; url: string } => Boolean(source));
}

function activityRequestContext(entry: StaffActivity) {
  const metadata = entry.metadata ?? {};
  const text = (key: string) => (typeof metadata[key] === 'string' ? String(metadata[key]).trim() : '');
  const question = text('question');
  const query = text('query');
  const viewer = text('viewer');
  const provider = text('provider');
  const model = text('model');
  const tier = text('tier');
  const request = text('request');
  const requestTitle = text('requestTitle');
  const requestKind = text('requestKind');
  const priority = text('priority');
  if (!question && !query && !model && !request) return null;
  return { question, query, viewer, provider, model, tier, request, requestTitle, requestKind, priority };
}

function activityTone(status: string | null | undefined) {
  if (status === 'failed' || status === 'error') return 'danger';
  if (status === 'warning' || status === 'pending') return 'warning';
  if (status === 'working' || status === 'queued') return 'working';
  return 'good';
}

function chatProviderLabel(provider: 'youtube' | 'twitch') {
  return provider === 'youtube' ? 'YouTube' : 'Twitch';
}

export function AiTeamPanel() {
  const [members, setMembers] = useState<Member[]>([]);
  const [teamActivity, setTeamActivity] = useState<TeamActivity[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<AgentTab>('workspace');
  const [draft, setDraft] = useState<MemberDraft | null>(null);
  const [assignment, setAssignment] = useState<AssignmentDraft>(emptyAssignment);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState<'all' | 'tasks' | 'live' | 'research' | 'settings'>('all');
  const [testProvider, setTestProvider] = useState<'youtube' | 'twitch' | 'studio'>('studio');
  const [testMessage, setTestMessage] = useState('Welche Quellen belegen die zentrale Aussage?');
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function loadTeam() {
    try {
      const [team, nextSettings, nextStatus] = await Promise.all([
        api<{ members: Member[]; activity: TeamActivity[] }>('/api/ai-team'),
        api<Settings>('/api/ai-host/settings'),
        api<Status>('/api/ai-host/status'),
      ]);
      setMembers(team.members);
      setTeamActivity(Array.isArray(team.activity) ? team.activity : []);
      setSettings((current) => current ?? nextSettings);
      setStatus(nextStatus);
      setError('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }

  async function refreshWorkspace(id = selectedId) {
    if (!id) return;
    try {
      const next = await api<Workspace>(`/api/ai-team/members/${encodeURIComponent(id)}`);
      setWorkspace(next);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }

  async function openWorkspace(member: Member) {
    setSelectedId(member.id);
    setWorkspace(null);
    setWorkspaceLoading(true);
    setActiveTab('workspace');
    setAssignment(emptyAssignment);
    setExpandedTask(null);
    try {
      const next = await api<Workspace>(`/api/ai-team/members/${encodeURIComponent(member.id)}`);
      setWorkspace(next);
      setDraft(memberDraft(next.member));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
      setSelectedId(null);
    } finally {
      setWorkspaceLoading(false);
    }
  }

  function closeWorkspace() {
    if (working) return;
    setSelectedId(null);
    setWorkspace(null);
    setDraft(null);
  }

  useEffect(() => {
    void loadTeam();
    const timer = window.setInterval(() => void loadTeam(), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedId || activeTab === 'settings') return;
    const timer = window.setInterval(() => void refreshWorkspace(selectedId), 6_000);
    return () => window.clearInterval(timer);
  }, [selectedId, activeTab]);

  useEffect(() => {
    if (!selectedId) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeWorkspace();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [selectedId, working]);

  async function saveSettings() {
    if (!settings) return;
    setWorking('settings');
    setMessage('');
    setError('');
    try {
      const saved = await api<Settings>('/api/ai-host/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: settings.enabled,
          liveStreamUrl: settings.live_stream_url || null,
          liveChatId: settings.live_chat_id || null,
          chatSourceMode: settings.chat_source_mode,
          chatPlatforms: settings.chat_platforms?.length ? settings.chat_platforms : ['youtube'],
          twitchChannel: settings.twitch_channel || null,
          activeModeratorId: settings.active_moderator_id,
          overlayPosition: settings.overlay_position,
          overlayScale: settings.overlay_scale,
          showAvatar: settings.show_avatar,
          showChat: settings.show_chat,
          anonymizeAuthors: settings.anonymize_authors,
          voiceEnabled: settings.voice_enabled,
          avatarVoiceSync: settings.avatar_voice_sync,
          interactionMode: settings.interaction_mode,
          questionIntervalSeconds: settings.question_interval_seconds,
          responseCooldownSeconds: settings.response_cooldown_seconds,
          responseDurationSeconds: settings.response_duration_seconds,
          maxTurnsPerHour: settings.max_turns_per_hour,
          maxChatMessagesPerTurn: settings.max_chat_messages_per_turn,
          minimumChatMessages: settings.minimum_chat_messages,
          participationPrompt: settings.participation_prompt,
        }),
      });
      setSettings(saved);
      setMessage('Das Senderteam und die plattformübergreifende Chat-Regie übernehmen die neuen Einstellungen.');
      await loadTeam();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function updateMember(member: Member, patch: Partial<Member>) {
    setWorking(`member-${member.id}`);
    try {
      await api(`/api/ai-team/members/${encodeURIComponent(member.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await Promise.all([loadTeam(), selectedId === member.id ? refreshWorkspace(member.id) : Promise.resolve()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function saveMember() {
    if (!selectedId || !draft) return;
    setWorking('member-settings');
    setError('');
    try {
      await api(`/api/ai-team/members/${encodeURIComponent(selectedId)}`, {
        method: 'PATCH',
        body: JSON.stringify(draft),
      });
      await Promise.all([loadTeam(), refreshWorkspace(selectedId)]);
      setMessage(`${draft.display_name}s Arbeitsplatz wurde gespeichert.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function createTask(override?: Partial<AssignmentDraft>) {
    if (!selectedId) return;
    const payload = { ...assignment, ...override };
    if (!payload.title.trim() || !payload.instructions.trim()) return;
    setWorking('new-task');
    setError('');
    try {
      const task = await api<StaffTask>(`/api/ai-team/members/${encodeURIComponent(selectedId)}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          kind: payload.kind,
          title: payload.title,
          instructions: payload.instructions,
          priority: payload.priority,
          dueAt: payload.dueAt ? new Date(payload.dueAt).toISOString() : null,
        }),
      });
      setAssignment(emptyAssignment);
      setExpandedTask(task.id);
      setMessage(
        `Aufgabe an ${workspace?.member.display_name ?? 'den Agenten'} übergeben. Die Bearbeitung startet automatisch.`,
      );
      await Promise.all([refreshWorkspace(selectedId), loadTeam()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function taskAction(task: StaffTask, action: 'cancel' | 'retry' | 'approve') {
    setWorking(`task-${task.id}`);
    setError('');
    try {
      await api(`/api/ai-team/tasks/${encodeURIComponent(task.id)}/${action}`, { method: 'POST' });
      await Promise.all([refreshWorkspace(task.staff_member_id), loadTeam()]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function sendTest() {
    setWorking('test');
    setError('');
    try {
      await api('/api/ai-host/test-chat', {
        method: 'POST',
        body: JSON.stringify({ message: testMessage, author: 'Studiotest', provider: testProvider }),
      });
      setMessage('Testbeitrag wurde der Chat-Redaktion übergeben.');
      setTestMessage('');
      window.setTimeout(() => void loadTeam(), 2_000);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setWorking('');
    }
  }

  async function decide(id: string, action: 'approve' | 'reject') {
    await api(`/api/ai-host/turns/${id}/${action}`, { method: 'POST' });
    await loadTeam();
  }

  function toggleChatPlatform(platform: 'youtube' | 'twitch') {
    if (!settings) return;
    const selected: Array<'youtube' | 'twitch'> = settings.chat_platforms?.length
      ? settings.chat_platforms
      : ['youtube'];
    const next: Array<'youtube' | 'twitch'> = selected.includes(platform)
      ? selected.filter((item) => item !== platform)
      : [...selected, platform];
    if (!next.length) return;
    setSettings({ ...settings, chat_platforms: next });
  }

  const filteredActivity = useMemo(() => {
    if (!workspace) return [];
    if (activityFilter === 'all') return workspace.activity;
    if (activityFilter === 'live')
      return workspace.activity.filter(
        (entry) =>
          entry.event_type === 'live_turn' ||
          entry.event_type.startsWith('live_') ||
          entry.event_type.startsWith('chat_') ||
          entry.event_type.startsWith('youtube_chat_') ||
          entry.event_type.startsWith('voice_'),
      );
    if (activityFilter === 'research')
      return workspace.activity.filter(
        (entry) => entry.event_type.includes('research') || entry.event_type === 'chat_question_identified',
      );
    if (activityFilter === 'settings')
      return workspace.activity.filter((entry) => entry.event_type === 'settings_updated');
    return workspace.activity.filter((entry) => entry.event_type.startsWith('task_'));
  }, [workspace, activityFilter]);

  const selectedMember = workspace?.member ?? members.find((member) => member.id === selectedId) ?? null;
  const selectedChatPlatforms: Array<'youtube' | 'twitch'> = settings?.chat_platforms?.length
    ? settings.chat_platforms
    : ['youtube'];
  const connectedChatProviders = selectedChatPlatforms.filter(
    (provider) => status?.chatProviders?.[provider]?.connected,
  );
  const runtimeFresh = Boolean(
    status?.runtime.lastTickAt && Date.now() - Date.parse(status.runtime.lastTickAt) < 20_000,
  );
  const samMember = members.find((member) => member.id === 'chat-analyst');
  const samMonitoring = Boolean(
    samMember?.enabled &&
    settings?.enabled &&
    settings.show_chat &&
    settings.interaction_mode !== 'off' &&
    status?.runtime.running &&
    status.session,
  );
  const latestSamActivity = teamActivity.find((entry) => entry.staff_member_id === 'chat-analyst') ?? null;
  const latestResearchActivity =
    teamActivity.find(
      (entry) =>
        ['editor', 'fact-checker'].includes(entry.staff_member_id) &&
        (entry.event_type.includes('research') || entry.event_type.includes('source_')),
    ) ?? null;
  const latestHandoff =
    teamActivity.find(
      (entry) =>
        entry.event_type === 'live_chat_handoff_to_moderator' || entry.event_type === 'researched_chat_answer_prepared',
    ) ?? null;
  const currentChatTurn = Boolean(status?.turn && ['chat-response', 'chat-commentary'].includes(status.turn.kind));

  return (
    <section className="ai-team-section">
      <header className="ai-team-title">
        <div>
          <p className="eyebrow">Virtuelle TV-Firma</p>
          <h2>Interaktives Senderteam</h2>
          <p>
            Öffne einen KI-Mitarbeiter, konfiguriere seine Rolle, übergib Aufträge und verfolge jede Aktivität
            transparent.
          </p>
        </div>
        <span className={`integration-status ${settings?.enabled && status?.runtime.running ? 'good' : 'warning'}`}>
          <i />
          {settings?.enabled ? 'Auf Sendung' : 'Pausiert'}
        </span>
      </header>
      {message && (
        <div className="overview-notice">
          <CheckCircle2 size={16} />
          {message}
        </div>
      )}
      {error && (
        <div className="overview-notice error">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      <section className="agent-operations-board">
        <header className="agent-operations-header">
          <div>
            <p className="eyebrow">Live aus der virtuellen Redaktion</p>
            <h3>Agenten-Leitstand</h3>
            <p>Reale Chat-Eingänge, Sams Entscheidungen, Recherche und Übergaben an die Moderation.</p>
          </div>
          <button type="button" onClick={() => void loadTeam()} title="Agenten-Leitstand aktualisieren">
            <RefreshCw size={16} />
            Live aktualisieren
          </button>
        </header>

        <div className="agent-operations-kpis">
          <article className={runtimeFresh ? 'tone-good' : 'tone-danger'}>
            <span>
              <Activity />
            </span>
            <div>
              <small>AGENTEN-LAUFZEIT</small>
              <strong>
                {status?.runtime.busy ? 'Verarbeitet gerade' : runtimeFresh ? 'Takt aktiv' : 'Keine Rückmeldung'}
              </strong>
              <p>Letzter Lauf {relativeDate(status?.runtime.lastTickAt)}</p>
            </div>
          </article>
          <article
            className={samMonitoring ? (connectedChatProviders.length ? 'tone-good' : 'tone-warning') : 'tone-idle'}
          >
            <span>
              <MessageCircle />
            </span>
            <div>
              <small>SAM · CHAT-RADAR</small>
              <strong>{samMonitoring ? 'Überwacht live' : 'Wartet auf Sendung'}</strong>
              <p>
                {connectedChatProviders.length
                  ? `${connectedChatProviders.map(chatProviderLabel).join(' + ')} verbunden`
                  : status?.session
                    ? 'Chatverbindung wird geprüft'
                    : 'Startet automatisch im interaktiven Format'}
              </p>
            </div>
          </article>
          <article className={(status?.chatQueue?.pending_questions ?? 0) > 0 ? 'tone-working' : 'tone-good'}>
            <span>
              <Inbox />
            </span>
            <div>
              <small>CHAT-QUEUE</small>
              <strong>{status?.chatQueue?.pending_total ?? 0} offen</strong>
              <p>
                {status?.chatQueue
                  ? `${status.chatQueue.pending_questions} direkte Fragen · ${status.chatQueue.processed_total} verarbeitet`
                  : 'Keine aktive Chat-Sitzung'}
              </p>
            </div>
          </article>
          <article
            className={currentChatTurn ? 'tone-working' : status?.runtime.lastVoiceError ? 'tone-danger' : 'tone-good'}
          >
            <span>
              <Mic2 />
            </span>
            <div>
              <small>MIA · OVERLAY</small>
              <strong>
                {currentChatTurn
                  ? 'Gerade auf Sendung'
                  : status?.runtime.voiceJobs
                    ? 'Stimme wird erzeugt'
                    : 'Sendebereit'}
              </strong>
              <p>
                {latestHandoff
                  ? `Letzte Übergabe ${relativeDate(latestHandoff.created_at)}`
                  : 'Noch keine Chatübergabe'}
              </p>
            </div>
          </article>
        </div>

        <div className="agent-live-pipeline" aria-label="Live-Arbeitsablauf der KI-Redaktion">
          <article className={connectedChatProviders.length ? 'complete' : samMonitoring ? 'waiting' : ''}>
            <i>1</i>
            <div>
              <strong>Chat empfangen</strong>
              <small>
                {status?.chatQueue?.last_received_at
                  ? relativeDate(status.chatQueue.last_received_at)
                  : 'Wartet auf Beitrag'}
              </small>
            </div>
          </article>
          <ChevronRight />
          <article className={latestSamActivity ? 'complete' : samMonitoring ? 'working' : ''}>
            <i>2</i>
            <div>
              <strong>Sam klassifiziert</strong>
              <small>{latestSamActivity?.title ?? 'Frage, Vorschlag oder Diskussion'}</small>
            </div>
          </article>
          <ChevronRight />
          <article className={latestResearchActivity ? 'complete' : ''}>
            <i>3</i>
            <div>
              <strong>Redaktion recherchiert</strong>
              <small>{latestResearchActivity?.title ?? 'Quellenpaket wird bei Bedarf erstellt'}</small>
            </div>
          </article>
          <ChevronRight />
          <article className={latestHandoff ? 'complete' : ''}>
            <i>4</i>
            <div>
              <strong>Mia übernimmt</strong>
              <small>{latestHandoff?.title ?? 'Sichere Antwort wartet auf Übergabe'}</small>
            </div>
          </article>
        </div>

        <div className="agent-live-feed">
          <header>
            <div>
              <strong>Aktuelles Redaktionsprotokoll</strong>
              <small>Automatisch aktualisiert · anklicken öffnet den Arbeitsplatz</small>
            </div>
            <span>{teamActivity.length} Ereignisse geladen</span>
          </header>
          {!teamActivity.length && (
            <div className="hub-empty compact">
              <Activity />
              <span>Noch keine Agentenaktivität protokolliert.</span>
            </div>
          )}
          {teamActivity.slice(0, 8).map((entry) => {
            const member = members.find((candidate) => candidate.id === entry.staff_member_id);
            return (
              <button
                type="button"
                key={`${entry.event_type}-${entry.id}`}
                onClick={() => member && void openWorkspace(member)}
                disabled={!member}
              >
                <span className={`agent-feed-state tone-${activityTone(entry.status)}`}>
                  <i />
                </span>
                <span className="agent-feed-copy">
                  <small>
                    {entry.display_name} · {entry.job_title}
                  </small>
                  <strong>{entry.title}</strong>
                  {entry.detail && <em>{entry.detail}</em>}
                </span>
                <time dateTime={entry.created_at}>{relativeDate(entry.created_at)}</time>
                <ChevronRight size={15} />
              </button>
            );
          })}
        </div>
      </section>

      <div className="ai-team-live-grid">
        <article className="ai-team-program">
          <span className="ai-team-avatar">
            <i />
          </span>
          <div>
            <small>AKTUELLE KI-MODERATION</small>
            <strong>
              {status?.turn?.headline ??
                (status?.session ? 'Nächster Einsatz wird vorbereitet' : 'Bereit für das laufende Programm')}
            </strong>
            <p>
              {status?.turn?.text ??
                (status?.session
                  ? `${status.session.video_title} · ${status.session.channel_title}`
                  : 'Die Avatar-Moderation reagiert im Programm auf YouTube- und Twitch-Chat.')}
            </p>
          </div>
          <span className={status?.session ? 'state-pill success' : 'state-pill'}>
            {status?.session?.status ?? 'bereit'}
          </span>
        </article>
        <article className="ai-team-safety">
          <ShieldCheck />
          <div>
            <strong>Sicherer Autonomiemodus</strong>
            <p>
              Chattexte sind Daten, keine Anweisungen. Namen, Kontaktdaten, Spam und Angriffe werden nicht verstärkt.
            </p>
          </div>
        </article>
      </div>

      <div className="ai-staff-grid">
        {members.map((member) => (
          <article
            key={member.id}
            style={{ '--staff-accent': member.accent_color } as React.CSSProperties}
            className={`ai-staff-card ${member.enabled ? 'enabled' : ''} status-${member.id === 'chat-analyst' && samMonitoring ? 'working' : member.work_status}`}
            role="button"
            tabIndex={0}
            aria-label={`${member.display_name}, ${member.job_title}, Arbeitsplatz öffnen`}
            onClick={() => void openWorkspace(member)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') void openWorkspace(member);
            }}
          >
            <div className="staff-card-head">
              <span>{roleIcon(member.role)}</span>
              <label
                className="switch"
                onClick={(event) => event.stopPropagation()}
                title={member.enabled ? 'Agent pausieren' : 'Agent aktivieren'}
              >
                <input
                  type="checkbox"
                  checked={member.enabled}
                  disabled={working === `member-${member.id}`}
                  onChange={(event) => void updateMember(member, { enabled: event.target.checked })}
                />
                <i />
              </label>
            </div>
            <div className="staff-identity">
              <strong>{member.display_name}</strong>
              <span>{member.job_title}</span>
            </div>
            <p>{member.description}</p>
            <div className="staff-work-state">
              <i />
              <span>
                <strong>
                  {member.id === 'chat-analyst' && samMonitoring
                    ? connectedChatProviders.length
                      ? 'Analysiert Livechat'
                      : 'Prüft Chatverbindung'
                    : workStatusLabel[member.work_status]}
                </strong>
                <small>
                  {member.id === 'chat-analyst' && samMonitoring
                    ? (latestSamActivity?.title ?? 'Fragen, Vorschläge und Diskussionen werden getrennt priorisiert')
                    : (member.current_task_title ?? `Letzte Aktivität ${relativeDate(member.last_activity_at)}`)}
                </small>
              </span>
            </div>
            <div className="staff-card-metrics">
              <span>
                <strong>{member.open_tasks}</strong> offen
              </span>
              <span>
                <strong>{member.completed_tasks}</strong> erledigt
              </span>
              <span>
                <strong>{member.total_tasks}</strong> gesamt
              </span>
            </div>
            <button
              type="button"
              className="staff-open-button"
              onClick={(event) => {
                event.stopPropagation();
                void openWorkspace(member);
              }}
            >
              Arbeitsplatz öffnen <ChevronRight size={15} />
            </button>
          </article>
        ))}
      </div>

      {settings && (
        <div className="ai-team-settings-grid">
          <section className="hub-panel">
            <header>
              <div>
                <p className="eyebrow">Overlay & Stimme</p>
                <h3>Avatar-Regie</h3>
              </div>
              <Eye />
            </header>
            <div className="friendly-settings-grid">
              <label>
                <span>Position</span>
                <select
                  value={settings.overlay_position}
                  onChange={(event) =>
                    setSettings({ ...settings, overlay_position: event.target.value as Settings['overlay_position'] })
                  }
                >
                  <option value="top-left">Oben links</option>
                  <option value="top-right">Oben rechts</option>
                  <option value="bottom-left">Unten links</option>
                  <option value="bottom-right">Unten rechts</option>
                </select>
              </label>
              <label>
                <span>Größe</span>
                <div className="range-field">
                  <input
                    type="range"
                    min="65"
                    max="140"
                    value={settings.overlay_scale}
                    onChange={(event) => setSettings({ ...settings, overlay_scale: Number(event.target.value) })}
                  />
                  <strong>{settings.overlay_scale}%</strong>
                </div>
              </label>
              <label>
                <span>Regelmäßiger Gesprächsimpuls</span>
                <div className="unit-input">
                  <input
                    type="number"
                    min="20"
                    max="900"
                    value={settings.question_interval_seconds}
                    onChange={(event) =>
                      setSettings({ ...settings, question_interval_seconds: Number(event.target.value) })
                    }
                  />
                  <em>Sek.</em>
                </div>
              </label>
              <label>
                <span>{settings.avatar_voice_sync ? 'Fallback-Einblenddauer' : 'Einblenddauer'}</span>
                <div className="unit-input">
                  <input
                    type="number"
                    min="8"
                    max="120"
                    value={settings.response_duration_seconds}
                    onChange={(event) =>
                      setSettings({ ...settings, response_duration_seconds: Number(event.target.value) })
                    }
                  />
                  <em>Sek.</em>
                </div>
              </label>
            </div>
            <div className="automation-toggles">
              <label>
                <input
                  type="checkbox"
                  checked={settings.show_avatar}
                  onChange={(event) => setSettings({ ...settings, show_avatar: event.target.checked })}
                />
                <span>
                  <strong>Avatar zeigen</strong>
                  <small>Immer klar als KI-Moderation gekennzeichnet.</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.voice_enabled}
                  onChange={(event) => setSettings({ ...settings, voice_enabled: event.target.checked })}
                />
                <span>
                  <strong>Sprechen lassen</strong>
                  <small>TTS wird separat in OBS ausgegeben.</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.avatar_voice_sync}
                  disabled={!settings.show_avatar || !settings.voice_enabled}
                  onChange={(event) => setSettings({ ...settings, avatar_voice_sync: event.target.checked })}
                />
                <span>
                  <strong>Mit Stimme synchronisieren</strong>
                  <small>Ava und Textbox erscheinen erst vor dem TTS-Start und verschwinden am Audioende.</small>
                </span>
              </label>
            </div>
          </section>

          <section className="hub-panel ai-chat-control-panel">
            <header>
              <div>
                <p className="eyebrow">Plattformübergreifender Livechat</p>
                <h3>Interaktionsregie</h3>
              </div>
              <MessageCircle />
            </header>
            <div className="chat-platform-picker">
              <button
                type="button"
                className={settings.chat_platforms?.includes('youtube') ? 'selected' : ''}
                onClick={() => toggleChatPlatform('youtube')}
              >
                <Video size={18} />
                <span>
                  <strong>YouTube</strong>
                  <small>{status?.chatProviders?.youtube?.configured ? 'Abrufbereit' : 'Einrichtung prüfen'}</small>
                </span>
                <i />
              </button>
              <button
                type="button"
                className={settings.chat_platforms?.includes('twitch') ? 'selected' : ''}
                onClick={() => toggleChatPlatform('twitch')}
              >
                <RadioTower size={18} />
                <span>
                  <strong>Twitch</strong>
                  <small>
                    {status?.chatProviders?.twitch?.connected
                      ? 'Live verbunden'
                      : status?.chatProviders?.twitch?.connecting
                        ? 'Verbindet …'
                        : status?.chatProviders?.twitch?.configured
                          ? 'Bereit'
                          : 'Kanal fehlt'}
                  </small>
                </span>
                <i />
              </button>
            </div>
            {settings.chat_platforms?.includes('youtube') && (
              <>
                <label>
                  Chatquelle
                  <select
                    value={settings.chat_source_mode}
                    onChange={(event) =>
                      setSettings({ ...settings, chat_source_mode: event.target.value as Settings['chat_source_mode'] })
                    }
                  >
                    <option value="channel">Eigener Sendekanal</option>
                    <option value="content">Chat des laufenden YouTube-Quellstreams</option>
                  </select>
                </label>
                {settings.chat_source_mode === 'channel' && (
                  <label>
                    URL des eigenen YouTube-Livestreams
                    <input
                      type="url"
                      value={settings.live_stream_url ?? ''}
                      onChange={(event) => setSettings({ ...settings, live_stream_url: event.target.value })}
                      placeholder="https://www.youtube.com/watch?v=…"
                    />
                  </label>
                )}
              </>
            )}
            {settings.chat_platforms?.includes('twitch') && (
              <label>
                Twitch-Kanalname oder Kanal-URL
                <input
                  value={settings.twitch_channel ?? ''}
                  onChange={(event) => setSettings({ ...settings, twitch_channel: event.target.value })}
                  placeholder="kanalname oder https://twitch.tv/kanalname"
                />
              </label>
            )}
            <div className="friendly-settings-grid compact">
              <label>
                <span>Mindestabstand für Chatantworten</span>
                <div className="unit-input">
                  <input
                    type="number"
                    min="20"
                    max="900"
                    value={settings.response_cooldown_seconds}
                    onChange={(event) =>
                      setSettings({ ...settings, response_cooldown_seconds: Number(event.target.value) })
                    }
                  />
                  <em>Sek.</em>
                </div>
              </label>
              <label>
                <span>Beiträge pro Reaktion</span>
                <div className="unit-input">
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={settings.minimum_chat_messages}
                    onChange={(event) =>
                      setSettings({ ...settings, minimum_chat_messages: Number(event.target.value) })
                    }
                  />
                  <em>min.</em>
                </div>
              </label>
            </div>
            <label>
              Reaktionsmodus
              <select
                value={settings.interaction_mode}
                onChange={(event) =>
                  setSettings({ ...settings, interaction_mode: event.target.value as Settings['interaction_mode'] })
                }
              >
                <option value="auto-safe">Automatisch nach Sicherheitsfilter</option>
                <option value="review">Redaktion gibt Antworten frei</option>
                <option value="off">Keine Chatantworten</option>
              </select>
            </label>
            <label>
              Teilnahmeaufruf
              <textarea
                rows={2}
                value={settings.participation_prompt}
                onChange={(event) => setSettings({ ...settings, participation_prompt: event.target.value })}
              />
            </label>
            <div className="chat-test-row">
              <select
                aria-label="Testplattform"
                value={testProvider}
                onChange={(event) => setTestProvider(event.target.value as typeof testProvider)}
              >
                <option value="studio">Studio</option>
                <option value="youtube">YouTube</option>
                <option value="twitch">Twitch</option>
              </select>
              <input
                value={testMessage}
                onChange={(event) => setTestMessage(event.target.value)}
                placeholder="Testbeitrag für den Chat"
              />
              <button
                onClick={() => void sendTest()}
                disabled={!status?.session || !testMessage.trim() || working === 'test'}
              >
                {working === 'test' ? <LoaderCircle className="spin" /> : <Send />}Testen
              </button>
            </div>
            <small className={status?.chatConfigured ? 'good-text' : 'warning-text'}>
              {status?.chatConfigured
                ? 'Mindestens eine Chatplattform ist abrufbereit. Antworten erscheinen im Avatar-Overlay.'
                : 'Noch keine ausgewählte Chatplattform ist vollständig eingerichtet.'}
            </small>
          </section>
        </div>
      )}

      <div className="ai-team-actions">
        <button
          className={settings?.enabled ? 'pause-button' : 'primary-button'}
          onClick={() => settings && setSettings({ ...settings, enabled: !settings.enabled })}
        >
          {settings?.enabled ? (
            <>
              <Pause />
              Team pausieren
            </>
          ) : (
            <>
              <Play />
              Team aktivieren
            </>
          )}
        </button>
        <button className="primary-button" onClick={() => void saveSettings()} disabled={!settings || Boolean(working)}>
          {working === 'settings' ? <LoaderCircle className="spin" /> : <Save />}Teamkonfiguration speichern
        </button>
      </div>

      {status?.recentTurns.some((turn) => turn.status === 'pending') && (
        <section className="hub-panel moderation-review">
          <header>
            <div>
              <p className="eyebrow">Freigabemodus</p>
              <h3>Wartende Moderationen</h3>
            </div>
            <Users />
          </header>
          {status.recentTurns
            .filter((turn) => turn.status === 'pending')
            .map((turn) => (
              <article key={turn.id}>
                <div>
                  <strong>{turn.headline}</strong>
                  <p>{turn.text}</p>
                </div>
                <button onClick={() => void decide(turn.id, 'reject')}>Ablehnen</button>
                <button className="primary-button" onClick={() => void decide(turn.id, 'approve')}>
                  Freigeben
                </button>
              </article>
            ))}
        </section>
      )}

      {selectedId && (
        <div className="studio-modal-backdrop ai-agent-backdrop" onMouseDown={closeWorkspace}>
          <section
            className="ai-agent-workbench"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-agent-title"
            onMouseDown={(event) => event.stopPropagation()}
            style={{ '--agent-accent': selectedMember?.accent_color ?? '#22d3ee' } as React.CSSProperties}
          >
            <header className="ai-agent-header">
              <div className="ai-agent-portrait">{selectedMember ? roleIcon(selectedMember.role, 26) : <Bot />}</div>
              <div>
                <p className="eyebrow">KI-Mitarbeiter · Persönlicher Arbeitsplatz</p>
                <h2 id="ai-agent-title">{selectedMember?.display_name ?? 'Agent wird geladen'}</h2>
                <span>{selectedMember?.job_title}</span>
              </div>
              {selectedMember && (
                <span className={`agent-live-status status-${selectedMember.work_status}`}>
                  <i />
                  {workStatusLabel[selectedMember.work_status]}
                </span>
              )}
              <button
                className="ai-agent-close"
                type="button"
                aria-label="Agenten-Arbeitsplatz schließen"
                onClick={closeWorkspace}
              >
                <X size={20} />
              </button>
            </header>

            <nav className="ai-agent-tabs" aria-label="Agenten-Arbeitsplatz">
              <button className={activeTab === 'workspace' ? 'active' : ''} onClick={() => setActiveTab('workspace')}>
                <Inbox size={16} />
                Arbeitsplatz{workspace?.metrics.open ? <b>{workspace.metrics.open}</b> : null}
              </button>
              <button className={activeTab === 'settings' ? 'active' : ''} onClick={() => setActiveTab('settings')}>
                <Settings2 size={16} />
                Einstellungen
              </button>
              <button className={activeTab === 'history' ? 'active' : ''} onClick={() => setActiveTab('history')}>
                <History size={16} />
                Protokoll<span>{workspace?.activity.length ?? 0}</span>
              </button>
              <button
                className="agent-refresh"
                type="button"
                title="Arbeitsplatz aktualisieren"
                onClick={() => void refreshWorkspace()}
              >
                <RefreshCw size={16} className={workspaceLoading ? 'spin' : ''} />
              </button>
            </nav>

            <div className="ai-agent-content">
              {workspaceLoading && !workspace && (
                <div className="hub-empty">
                  <LoaderCircle className="spin" />
                  <strong>Arbeitsplatz wird geladen</strong>
                </div>
              )}

              {workspace && activeTab === 'workspace' && (
                <>
                  <div className="agent-metric-grid">
                    <article>
                      <span>
                        <ListChecks />
                      </span>
                      <div>
                        <small>Offene Aufträge</small>
                        <strong>{workspace.metrics.open}</strong>
                      </div>
                    </article>
                    <article>
                      <span>
                        <ClipboardCheck />
                      </span>
                      <div>
                        <small>Abgeschlossen</small>
                        <strong>{workspace.metrics.completed}</strong>
                      </div>
                    </article>
                    <article>
                      <span>
                        <Mic2 />
                      </span>
                      <div>
                        <small>Live-Einsätze</small>
                        <strong>{workspace.metrics.turns}</strong>
                      </div>
                    </article>
                    <article>
                      <span>
                        <Clock3 />
                      </span>
                      <div>
                        <small>Ø Bearbeitung</small>
                        <strong>
                          {workspace.metrics.average_completion_seconds
                            ? `${Math.max(1, Math.round(workspace.metrics.average_completion_seconds / 60))} min`
                            : '–'}
                        </strong>
                      </div>
                    </article>
                  </div>

                  <div className="agent-workspace-grid">
                    <section className="agent-assignment-composer">
                      <header>
                        <div>
                          <p className="eyebrow">Direkter Draht</p>
                          <h3>Neue Aufgabe an {workspace.member.display_name}</h3>
                        </div>
                        <Send size={19} />
                      </header>
                      <div className="agent-quick-prompts">
                        {(rolePrompts[workspace.member.role] ?? []).map((prompt) => (
                          <button
                            key={prompt.label}
                            type="button"
                            onClick={() =>
                              setAssignment({ ...assignment, title: prompt.title, instructions: prompt.instructions })
                            }
                          >
                            <Sparkles size={13} />
                            {prompt.label}
                          </button>
                        ))}
                      </div>
                      <label>
                        Art des Auftrags
                        <select
                          value={assignment.kind}
                          onChange={(event) =>
                            setAssignment({ ...assignment, kind: event.target.value as StaffTask['kind'] })
                          }
                        >
                          <option value="assignment">Arbeitsauftrag</option>
                          <option value="question">Direkte Frage</option>
                          <option value="review">Prüfauftrag</option>
                        </select>
                      </label>
                      <label>
                        Titel
                        <input
                          value={assignment.title}
                          onChange={(event) => setAssignment({ ...assignment, title: event.target.value })}
                          placeholder="Was soll erledigt werden?"
                        />
                      </label>
                      <label>
                        Auftrag / Nachricht
                        <textarea
                          rows={6}
                          value={assignment.instructions}
                          onChange={(event) => setAssignment({ ...assignment, instructions: event.target.value })}
                          placeholder="Beschreibe Ziel, Kontext und gewünschtes Ergebnis …"
                        />
                      </label>
                      <div className="agent-assignment-meta">
                        <label>
                          Priorität
                          <select
                            value={assignment.priority}
                            onChange={(event) =>
                              setAssignment({ ...assignment, priority: event.target.value as StaffTask['priority'] })
                            }
                          >
                            <option value="low">Niedrig</option>
                            <option value="normal">Normal</option>
                            <option value="high">Hoch</option>
                            <option value="urgent">Dringend</option>
                          </select>
                        </label>
                        <label>
                          Fällig bis (optional)
                          <input
                            type="datetime-local"
                            value={assignment.dueAt}
                            onChange={(event) => setAssignment({ ...assignment, dueAt: event.target.value })}
                          />
                        </label>
                      </div>
                      {!workspace.member.enabled && (
                        <div className="agent-inline-warning">
                          <Pause size={15} />
                          Der Agent ist pausiert. Der Auftrag bleibt sicher in seiner Inbox, bis er aktiviert wird.
                        </div>
                      )}
                      <button
                        className="primary-button agent-submit-task"
                        type="button"
                        disabled={!assignment.title.trim() || !assignment.instructions.trim() || working === 'new-task'}
                        onClick={() => void createTask()}
                      >
                        {working === 'new-task' ? <LoaderCircle className="spin" /> : <Send />}Auftrag übergeben
                      </button>
                    </section>

                    <section className="agent-task-inbox">
                      <header>
                        <div>
                          <p className="eyebrow">Inbox & Ergebnisse</p>
                          <h3>Aufgabenverlauf</h3>
                        </div>
                        <span>{workspace.tasks.length} Einträge</span>
                      </header>
                      {!workspace.tasks.length && (
                        <div className="hub-empty">
                          <Inbox />
                          <strong>Noch keine Aufträge</strong>
                          <span>Der erste Auftrag erscheint hier mit Live-Status und Ergebnis.</span>
                        </div>
                      )}
                      <div className="agent-task-list">
                        {workspace.tasks.map((task) => {
                          const expanded = expandedTask === task.id;
                          const findings = resultList(task, 'findings');
                          const nextSteps = resultList(task, 'nextSteps');
                          return (
                            <article
                              key={task.id}
                              className={`agent-task-card status-${task.status} priority-${task.priority}`}
                            >
                              <button
                                className="agent-task-summary"
                                type="button"
                                onClick={() => setExpandedTask(expanded ? null : task.id)}
                              >
                                <span className="agent-task-state">
                                  {task.status === 'running' ? (
                                    <LoaderCircle className="spin" />
                                  ) : task.status === 'completed' ? (
                                    <CheckCircle2 />
                                  ) : task.status === 'failed' ? (
                                    <AlertTriangle />
                                  ) : task.status === 'waiting_review' ? (
                                    <FileCheck2 />
                                  ) : (
                                    <CircleDot />
                                  )}
                                </span>
                                <span>
                                  <small>
                                    {task.kind === 'question'
                                      ? 'FRAGE'
                                      : task.kind === 'review'
                                        ? 'PRÜFAUFTRAG'
                                        : 'AUFTRAG'}{' '}
                                    · {priorityLabel[task.priority]}
                                  </small>
                                  <strong>{task.title}</strong>
                                  <em>
                                    {task.result_summary ??
                                      task.error ??
                                      `${taskStatusLabel[task.status]} · ${relativeDate(task.updated_at)}`}
                                  </em>
                                </span>
                                <span className={`task-status status-${task.status}`}>
                                  {taskStatusLabel[task.status]}
                                </span>
                                {expanded ? <ChevronDown /> : <ChevronRight />}
                              </button>
                              {expanded && (
                                <div className="agent-task-detail">
                                  <div className="task-request">
                                    <small>DEIN AUFTRAG · {formatDate(task.created_at)}</small>
                                    <p>{task.instructions}</p>
                                  </div>
                                  {task.result_text && (
                                    <div className="task-response">
                                      <small>
                                        ANTWORT VON {workspace.member.display_name.toUpperCase()} ·{' '}
                                        {task.model ?? 'Modell'}
                                      </small>
                                      <p>{task.result_text}</p>
                                      {findings.length > 0 && (
                                        <>
                                          <strong>Feststellungen</strong>
                                          <ul>
                                            {findings.map((finding) => (
                                              <li key={finding}>{finding}</li>
                                            ))}
                                          </ul>
                                        </>
                                      )}
                                      {nextSteps.length > 0 && (
                                        <>
                                          <strong>Nächste Schritte</strong>
                                          <ol>
                                            {nextSteps.map((step) => (
                                              <li key={step}>{step}</li>
                                            ))}
                                          </ol>
                                        </>
                                      )}
                                    </div>
                                  )}
                                  {task.error && (
                                    <div className="agent-task-error">
                                      <AlertTriangle size={16} />
                                      <span>
                                        <strong>Bearbeitung fehlgeschlagen</strong>
                                        {task.error}
                                      </span>
                                    </div>
                                  )}
                                  <footer>
                                    <span>
                                      Versuch {task.attempts || 0}
                                      {task.requested_by_name ? ` · von ${task.requested_by_name}` : ''}
                                    </span>
                                    <div>
                                      {['queued', 'running', 'waiting_review'].includes(task.status) && (
                                        <button
                                          type="button"
                                          onClick={() => void taskAction(task, 'cancel')}
                                          disabled={working === `task-${task.id}`}
                                        >
                                          <Square size={14} />
                                          Abbrechen
                                        </button>
                                      )}
                                      {['failed', 'cancelled'].includes(task.status) && (
                                        <button
                                          type="button"
                                          onClick={() => void taskAction(task, 'retry')}
                                          disabled={working === `task-${task.id}`}
                                        >
                                          <RotateCcw size={14} />
                                          Erneut versuchen
                                        </button>
                                      )}
                                      {task.status === 'waiting_review' && (
                                        <button
                                          className="primary-button"
                                          type="button"
                                          onClick={() => void taskAction(task, 'approve')}
                                          disabled={working === `task-${task.id}`}
                                        >
                                          <CheckCircle2 size={14} />
                                          Ergebnis freigeben
                                        </button>
                                      )}
                                    </div>
                                  </footer>
                                </div>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  </div>
                </>
              )}

              {workspace && draft && activeTab === 'settings' && (
                <div className="agent-settings-layout">
                  <section className="agent-settings-card">
                    <header>
                      <div>
                        <p className="eyebrow">Identität & Einsatz</p>
                        <h3>Rollenprofil</h3>
                      </div>
                      {roleIcon(workspace.member.role)}
                    </header>
                    <div className="agent-form-grid">
                      <label>
                        Name
                        <input
                          value={draft.display_name}
                          onChange={(event) => setDraft({ ...draft, display_name: event.target.value })}
                        />
                      </label>
                      <label>
                        Funktionsbezeichnung
                        <input
                          value={draft.job_title}
                          onChange={(event) => setDraft({ ...draft, job_title: event.target.value })}
                        />
                      </label>
                      <label className="wide">
                        Kurzbeschreibung
                        <textarea
                          rows={3}
                          value={draft.description}
                          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                        />
                      </label>
                      <label>
                        Autonomie
                        <select
                          value={draft.autonomy}
                          onChange={(event) =>
                            setDraft({ ...draft, autonomy: event.target.value as Member['autonomy'] })
                          }
                        >
                          <option value="auto">Selbstständig ausführen</option>
                          <option value="review">Ergebnis vor Freigabe prüfen</option>
                          <option value="suggest">Nur Vorschläge liefern</option>
                        </select>
                      </label>
                      <label>
                        Avatar-Stil
                        <select
                          value={draft.avatar_style}
                          onChange={(event) => setDraft({ ...draft, avatar_style: event.target.value })}
                        >
                          <option value="studio">Studio</option>
                          <option value="editorial">Redaktion</option>
                          <option value="analyst">Analyse</option>
                          <option value="producer">Produktion</option>
                          <option value="host">Moderation</option>
                          <option value="video">Video-Moderatorin</option>
                        </select>
                      </label>
                      <label>
                        Akzentfarbe
                        <input
                          className="agent-color-input"
                          type="color"
                          value={draft.accent_color}
                          onChange={(event) => setDraft({ ...draft, accent_color: event.target.value })}
                        />
                      </label>
                      <label className="agent-enabled-control">
                        <span>Agentenstatus</span>
                        <span className="toggle-setting">
                          <input
                            type="checkbox"
                            checked={draft.enabled}
                            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                          />
                          <i />
                          <b>{draft.enabled ? 'Aktiv' : 'Pausiert'}</b>
                        </span>
                      </label>
                    </div>
                  </section>

                  <section className="agent-settings-card">
                    <header>
                      <div>
                        <p className="eyebrow">Arbeitsweise</p>
                        <h3>Persönlichkeit & Qualitätsregeln</h3>
                      </div>
                      <Bot />
                    </header>
                    <div className="agent-form-grid">
                      <label>
                        Tonfall
                        <select
                          value={draft.config.tone}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              config: { ...draft.config, tone: event.target.value as MemberConfig['tone'] },
                            })
                          }
                        >
                          <option value="neutral">Neutral</option>
                          <option value="warm">Nahbar & warm</option>
                          <option value="analytical">Analytisch</option>
                          <option value="decisive">Entscheidungsstark</option>
                        </select>
                      </label>
                      <label>
                        Antwortumfang
                        <select
                          value={draft.config.responseDetail}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              config: {
                                ...draft.config,
                                responseDetail: event.target.value as MemberConfig['responseDetail'],
                              },
                            })
                          }
                        >
                          <option value="compact">Kompakt</option>
                          <option value="balanced">Ausgewogen</option>
                          <option value="detailed">Ausführlich</option>
                        </select>
                      </label>
                      <label>
                        Modellstrategie
                        <select
                          value={draft.config.modelStrategy}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              config: {
                                ...draft.config,
                                modelStrategy: event.target.value as MemberConfig['modelStrategy'],
                              },
                            })
                          }
                        >
                          <option value="speed">Geschwindigkeit</option>
                          <option value="balanced">Ausgewogen</option>
                          <option value="quality">Qualität</option>
                        </select>
                      </label>
                      <label className="wide">
                        Spezialgebiete (mit Komma trennen)
                        <input
                          value={draft.config.specialties.join(', ')}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              config: {
                                ...draft.config,
                                specialties: event.target.value
                                  .split(',')
                                  .map((item) => item.trim())
                                  .filter(Boolean)
                                  .slice(0, 12),
                              },
                            })
                          }
                        />
                      </label>
                      <label className="wide">
                        Dauerhafte Arbeitsanweisung
                        <textarea
                          rows={6}
                          value={draft.instructions}
                          onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
                        />
                      </label>
                    </div>
                    <div className="agent-policy-toggles">
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.config.proactive}
                          onChange={(event) =>
                            setDraft({ ...draft, config: { ...draft.config, proactive: event.target.checked } })
                          }
                        />
                        <span>
                          <strong>Proaktiv mitdenken</strong>
                          <small>Offene Risiken und nächste Schritte benennen.</small>
                        </span>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.config.requiresSources}
                          onChange={(event) =>
                            setDraft({ ...draft, config: { ...draft.config, requiresSources: event.target.checked } })
                          }
                        />
                        <span>
                          <strong>Quellenpflicht</strong>
                          <small>Fehlende Belege ausdrücklich markieren.</small>
                        </span>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={draft.config.notifyOnCompletion}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              config: { ...draft.config, notifyOnCompletion: event.target.checked },
                            })
                          }
                        />
                        <span>
                          <strong>Abschluss melden</strong>
                          <small>Fertige Aufträge im Arbeitsplatz hervorheben.</small>
                        </span>
                      </label>
                    </div>
                  </section>

                  {workspace.member.role === 'chat-analyst' && (
                    <section className="agent-settings-card agent-live-policy-card">
                      <header>
                        <div>
                          <p className="eyebrow">Sams Chat-Radar</p>
                          <h3>Echte Aktivität erkennen</h3>
                        </div>
                        <Activity />
                      </header>
                      <p>
                        Sam bündelt nur neue, sichere Beiträge aus den verbundenen Chats. Sendernachrichten, veraltete
                        Beiträge, Textduplikate und bereits kommentierte Themen lösen keine neue Mia-Einblendung aus.
                      </p>
                      <div className="agent-policy-toggles">
                        <label>
                          <input
                            type="checkbox"
                            checked={draft.config.chatAnalysisEnabled}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                config: { ...draft.config, chatAnalysisEnabled: event.target.checked },
                              })
                            }
                          />
                          <span>
                            <strong>Periodisches Chat-Lagebild</strong>
                            <small>Nur bei messbarer neuer Aktivität an Mia übergeben.</small>
                          </span>
                        </label>
                      </div>
                      <div className="agent-form-grid">
                        <label>
                          Analyse frühestens alle
                          <div className="unit-input">
                            <input
                              type="number"
                              min="1"
                              max="15"
                              step="1"
                              value={draft.config.chatAnalysisIntervalSeconds / 60}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  config: {
                                    ...draft.config,
                                    chatAnalysisIntervalSeconds: Math.round(Number(event.target.value) * 60),
                                  },
                                })
                              }
                            />
                            <em>Min.</em>
                          </div>
                        </label>
                        <label>
                          Aktivitätsfenster
                          <div className="unit-input">
                            <input
                              type="number"
                              min="1"
                              max="30"
                              step="1"
                              value={draft.config.chatActivityWindowSeconds / 60}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  config: {
                                    ...draft.config,
                                    chatActivityWindowSeconds: Math.round(Number(event.target.value) * 60),
                                  },
                                })
                              }
                            />
                            <em>Min.</em>
                          </div>
                        </label>
                        <label>
                          Unterschiedliche Beiträge
                          <input
                            type="number"
                            min="2"
                            max="20"
                            value={draft.config.chatMinimumDistinctMessages}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                config: {
                                  ...draft.config,
                                  chatMinimumDistinctMessages: Number(event.target.value),
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          Unterschiedliche Personen
                          <input
                            type="number"
                            min="1"
                            max="10"
                            value={draft.config.chatMinimumUniqueAuthors}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                config: { ...draft.config, chatMinimumUniqueAuthors: Number(event.target.value) },
                              })
                            }
                          />
                        </label>
                        <label>
                          Themen nicht wiederholen für
                          <div className="unit-input">
                            <input
                              type="number"
                              min="5"
                              max="180"
                              value={draft.config.chatDuplicateSuppressionMinutes}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  config: {
                                    ...draft.config,
                                    chatDuplicateSuppressionMinutes: Number(event.target.value),
                                  },
                                })
                              }
                            />
                            <em>Min.</em>
                          </div>
                        </label>
                      </div>
                      <div className="inline-notice success">
                        <ShieldCheck size={18} />
                        <span>
                          Standard: alle drei Minuten prüfen, mindestens drei unterschiedliche Beiträge von zwei
                          Personen und 30 Minuten Wiederholungsschutz.
                        </span>
                      </div>
                    </section>
                  )}

                  {['moderator', 'chat-moderator'].includes(workspace.member.role) && (
                    <section className="agent-settings-card agent-live-policy-card">
                      <header>
                        <div>
                          <p className="eyebrow">Live-Einsatz</p>
                          <h3>
                            {workspace.member.role === 'moderator' ? 'AVAs Video-Einordnung' : 'MIAs Chatmoderation'}
                          </h3>
                        </div>
                        <RadioTower />
                      </header>
                      <p>
                        {workspace.member.role === 'moderator'
                          ? 'Steuert, wie oft AVA das laufende Video anhand des vorhandenen Transkripts einordnet und wie viele unterschiedliche Aussagen die Redaktion vorbereitet.'
                          : 'Steuert, wie schnell Mia neue Chatdiskussionen aufgreift und wie tief Redaktion und Faktenprüfung ihre Antworten vorbereiten. Direkte Zuschauerfragen bleiben priorisiert.'}
                      </p>
                      <div className="agent-form-grid">
                        <label>
                          {workspace.member.role === 'moderator' ? 'Einordnungsfrequenz' : 'Chatreaktionsfrequenz'}
                          <select
                            value={draft.config.liveFrequency}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                config: {
                                  ...draft.config,
                                  liveFrequency: event.target.value as MemberConfig['liveFrequency'],
                                },
                              })
                            }
                          >
                            <option value="restrained">Zurückhaltend</option>
                            <option value="balanced">Ausgewogen</option>
                            <option value="active">Aktiv</option>
                          </select>
                          <small>
                            „Aktiv“ verkürzt die Abstände, ohne zwei Moderatoren gleichzeitig sprechen zu lassen.
                          </small>
                        </label>
                        <label>
                          {workspace.member.role === 'moderator' ? 'Transkript-Tiefe' : 'Recherche-Tiefe'}
                          <select
                            value={draft.config.contextDepth}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                config: {
                                  ...draft.config,
                                  contextDepth: event.target.value as MemberConfig['contextDepth'],
                                },
                              })
                            }
                          >
                            <option value="focused">Fokussiert</option>
                            <option value="balanced">Ausgewogen</option>
                            <option value="detailed">Detailliert</option>
                          </select>
                          <small>
                            {workspace.member.role === 'moderator'
                              ? 'Detailliert erzeugt künftig 8–12 Karten und bis zu 7 sinnvoll platzierte AVA-Pausen.'
                              : 'Detailliert berücksichtigt mehr belegte Quellen, Kontext und erkennbare Einschränkungen.'}
                          </small>
                        </label>
                      </div>
                      {workspace.member.role === 'chat-moderator' && (
                        <>
                          <div className="agent-policy-toggles">
                            <label>
                              <input
                                type="checkbox"
                                checked={draft.config.proactiveChatCommentary}
                                onChange={(event) =>
                                  setDraft({
                                    ...draft,
                                    config: { ...draft.config, proactiveChatCommentary: event.target.checked },
                                  })
                                }
                              />
                              <span>
                                <strong>Chat von selbst kommentieren</strong>
                                <small>
                                  Mia übernimmt Sams Lagebild auch dann, wenn niemand eine direkte Frage gestellt hat.
                                </small>
                              </span>
                            </label>
                          </div>
                          <div className="agent-form-grid">
                            <label>
                              Kommentar frühestens alle
                              <div className="unit-input">
                                <input
                                  type="number"
                                  min="1"
                                  max="15"
                                  step="1"
                                  value={draft.config.chatCommentaryIntervalSeconds / 60}
                                  onChange={(event) =>
                                    setDraft({
                                      ...draft,
                                      config: {
                                        ...draft.config,
                                        chatCommentaryIntervalSeconds: Math.round(Number(event.target.value) * 60),
                                      },
                                    })
                                  }
                                />
                                <em>Min.</em>
                              </div>
                            </label>
                            <label>
                              Sprech- und Einblenddauer
                              <div className="unit-input">
                                <input
                                  type="number"
                                  min="8"
                                  max="60"
                                  value={draft.config.chatCommentaryDurationSeconds}
                                  onChange={(event) =>
                                    setDraft({
                                      ...draft,
                                      config: {
                                        ...draft.config,
                                        chatCommentaryDurationSeconds: Number(event.target.value),
                                      },
                                    })
                                  }
                                />
                                <em>Sek.</em>
                              </div>
                            </label>
                          </div>
                        </>
                      )}
                      <div className="inline-notice success">
                        <ShieldCheck size={18} />
                        <span>
                          Freie OpenRouter-Modelle werden zuerst verwendet. Falls im KI Studio erlaubt, übernimmt danach
                          nur ein günstiges Modell innerhalb des Tages- und Anfragelimits.
                        </span>
                      </div>
                    </section>
                  )}

                  {['chat-analyst', 'chat-moderator', 'moderator'].includes(workspace.member.role) && settings && (
                    <section className="agent-settings-card agent-chat-specialist-card">
                      <header>
                        <div>
                          <p className="eyebrow">Echter Livechat</p>
                          <h3>Plattformen & Reaktionsrhythmus</h3>
                        </div>
                        <MessageCircle />
                      </header>
                      <p>
                        Diese Regeln werden von Chat-Analyst, AVA und Chatmoderatorin Mia gemeinsam genutzt. Der Analyst
                        bündelt sichere Beiträge; Mia beantwortet recherchierte Fragen im Live-Overlay.
                      </p>
                      <div className="chat-platform-picker">
                        <button
                          type="button"
                          className={selectedChatPlatforms.includes('youtube') ? 'selected' : ''}
                          onClick={() => toggleChatPlatform('youtube')}
                        >
                          <Video />
                          <span>
                            <strong>YouTube</strong>
                            <small>{status?.chatProviders?.youtube?.configured ? 'bereit' : 'nicht vollständig'}</small>
                          </span>
                          <i />
                        </button>
                        <button
                          type="button"
                          className={selectedChatPlatforms.includes('twitch') ? 'selected' : ''}
                          onClick={() => toggleChatPlatform('twitch')}
                        >
                          <RadioTower />
                          <span>
                            <strong>Twitch</strong>
                            <small>
                              {status?.chatProviders?.twitch?.connected ? 'verbunden' : 'bereit zur Verbindung'}
                            </small>
                          </span>
                          <i />
                        </button>
                      </div>
                      {selectedChatPlatforms.includes('twitch') && (
                        <label>
                          Twitch-Kanal
                          <input
                            value={settings.twitch_channel ?? ''}
                            onChange={(event) => setSettings({ ...settings, twitch_channel: event.target.value })}
                            placeholder="twitch.tv/kanal"
                          />
                        </label>
                      )}
                      <div className="agent-form-grid">
                        <label>
                          Regelmäßige Impulse
                          <input
                            type="number"
                            min="20"
                            max="900"
                            value={settings.question_interval_seconds}
                            onChange={(event) =>
                              setSettings({ ...settings, question_interval_seconds: Number(event.target.value) })
                            }
                          />
                        </label>
                        <label>
                          Mindestabstand Antworten
                          <input
                            type="number"
                            min="20"
                            max="900"
                            value={settings.response_cooldown_seconds}
                            onChange={(event) =>
                              setSettings({ ...settings, response_cooldown_seconds: Number(event.target.value) })
                            }
                          />
                        </label>
                        <label>
                          Min. Chatbeiträge
                          <select
                            value={settings.minimum_chat_messages}
                            onChange={(event) =>
                              setSettings({ ...settings, minimum_chat_messages: Number(event.target.value) })
                            }
                          >
                            {[1, 2, 3, 4, 5, 8, 10].map((count) => (
                              <option key={count} value={count}>
                                {count}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Max. Moderationen/Stunde
                          <input
                            type="number"
                            min="1"
                            max="60"
                            value={settings.max_turns_per_hour}
                            onChange={(event) =>
                              setSettings({ ...settings, max_turns_per_hour: Number(event.target.value) })
                            }
                          />
                        </label>
                      </div>
                      <button type="button" onClick={() => void saveSettings()} disabled={working === 'settings'}>
                        {working === 'settings' ? <LoaderCircle className="spin" /> : <Save />}Chat-Regeln speichern
                      </button>
                    </section>
                  )}

                  <footer className="agent-settings-actions">
                    <span>Änderungen werden protokolliert und gelten für neue Aufträge.</span>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => void saveMember()}
                      disabled={working === 'member-settings'}
                    >
                      {working === 'member-settings' ? <LoaderCircle className="spin" /> : <Save />}Agentenprofil
                      speichern
                    </button>
                  </footer>
                </div>
              )}

              {workspace && activeTab === 'history' && (
                <section className="agent-history-panel">
                  <header>
                    <div>
                      <p className="eyebrow">Nachvollziehbare KI-Arbeit</p>
                      <h3>Aktivitätsprotokoll</h3>
                      <p>
                        Aufträge, Quellenrecherche, Ergebnisse, Live-Einsätze und Einstellungen in einer gemeinsamen
                        Chronik.
                      </p>
                    </div>
                    <label>
                      Filtern
                      <select
                        value={activityFilter}
                        onChange={(event) => setActivityFilter(event.target.value as typeof activityFilter)}
                      >
                        <option value="all">Alles</option>
                        <option value="tasks">Aufgaben</option>
                        <option value="research">Quellenrecherche</option>
                        <option value="live">Live-Einsätze</option>
                        <option value="settings">Einstellungen</option>
                      </select>
                    </label>
                  </header>
                  {!filteredActivity.length && (
                    <div className="hub-empty">
                      <History />
                      <strong>Keine passenden Einträge</strong>
                    </div>
                  )}
                  <div className="agent-activity-timeline">
                    {filteredActivity.map((entry) => {
                      const researchSources = activityResearchSources(entry);
                      const requestContext = activityRequestContext(entry);
                      return (
                        <article key={`${entry.event_type}-${entry.id}`}>
                          <span className={`activity-icon type-${entry.event_type}`}>
                            {entry.event_type === 'live_turn' ? (
                              <Mic2 />
                            ) : entry.event_type === 'settings_updated' ? (
                              <Settings2 />
                            ) : entry.event_type.includes('failed') ? (
                              <AlertTriangle />
                            ) : entry.event_type.includes('completed') || entry.event_type.includes('approved') ? (
                              <CheckCircle2 />
                            ) : (
                              <Activity />
                            )}
                          </span>
                          <i />
                          <div>
                            <small>
                              {formatDate(entry.created_at)}
                              {entry.actor_name ? ` · ${entry.actor_name}` : ''}
                            </small>
                            <strong>{entry.title}</strong>
                            {requestContext && (
                              <div className="agent-research-request">
                                {requestContext.request && (
                                  <>
                                    <small>
                                      AUFTRAG
                                      {requestContext.requestKind
                                        ? ` · ${requestContext.requestKind.toUpperCase()}`
                                        : ''}
                                      {requestContext.priority ? ` · ${requestContext.priority.toUpperCase()}` : ''}
                                    </small>
                                    {requestContext.requestTitle && <strong>{requestContext.requestTitle}</strong>}
                                    <q>{requestContext.request}</q>
                                  </>
                                )}
                                {requestContext.question && (
                                  <>
                                    <small>
                                      ZUSCHAUERANFRAGE
                                      {requestContext.provider ? ` · ${requestContext.provider.toUpperCase()}` : ''}
                                      {requestContext.viewer ? ` · ${requestContext.viewer}` : ''}
                                    </small>
                                    <q>{requestContext.question}</q>
                                  </>
                                )}
                                {requestContext.query && <span>Recherche: {requestContext.query}</span>}
                                {requestContext.model && (
                                  <span>
                                    Modell: {requestContext.model}
                                    {requestContext.tier ? ` · ${requestContext.tier.toUpperCase()}` : ''}
                                  </span>
                                )}
                              </div>
                            )}
                            {entry.detail && <p>{entry.detail}</p>}
                            {researchSources.length > 0 && (
                              <div className="agent-research-sources">
                                {researchSources.map((source) => (
                                  <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>
                                    <span>
                                      <small>{source.publisher || 'Quelle'}</small>
                                      {source.title}
                                    </span>
                                    <ExternalLink />
                                  </a>
                                ))}
                              </div>
                            )}
                            <span className={`task-status status-${entry.status ?? 'info'}`}>
                              {entry.status ?? entry.event_type.replaceAll('_', ' ')}
                            </span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
