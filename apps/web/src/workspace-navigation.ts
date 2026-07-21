import {
  Activity,
  BarChart3,
  BellRing,
  Bot,
  BrainCircuit,
  CalendarDays,
  Clapperboard,
  FileClock,
  Files,
  Film,
  GalleryVerticalEnd,
  HeartPulse,
  Images,
  Library,
  MonitorPlay,
  MonitorUp,
  Newspaper,
  RadioTower,
  Rss,
  Scissors,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { routes } from './navigation.js';

export type WorkspaceId =
  | 'overview'
  | 'newsroom'
  | 'library'
  | 'shorts'
  | 'schedule'
  | 'control'
  | 'streaming'
  | 'overlays'
  | 'ai'
  | 'automation'
  | 'analytics'
  | 'system';

export type WorkspaceLink = {
  id: string;
  label: string;
  description: string;
  to: string;
  icon: LucideIcon;
  keywords: string;
  permission?: string;
};

export type Workspace = WorkspaceLink & {
  id: WorkspaceId;
  accent: string;
  matches: string[];
  children: WorkspaceLink[];
};

export const workspaces: Workspace[] = [
  {
    id: 'overview',
    label: 'Übersicht',
    description: 'Das komplette Studio auf einen Blick',
    to: routes.overview,
    icon: Activity,
    accent: 'cyan',
    keywords: 'dashboard start status studio live aktuell nächste sendung',
    matches: [routes.overview, routes.dashboard],
    children: [],
  },
  {
    id: 'newsroom',
    label: 'Newsroom',
    description: 'Quellen, Recherche und Redaktion',
    to: routes.newsroom,
    icon: Newspaper,
    accent: 'blue',
    keywords: 'rss artikel nachrichten quellen youtube recherche freigabe',
    matches: [routes.newsroom, routes.sources, routes.sourceHealth, routes.articles, routes.youtubeVideos],
    children: [
      {
        id: 'newsroom-home',
        label: 'Redaktionsdesk',
        description: 'Newsroom-Überblick',
        to: routes.newsroom,
        icon: GalleryVerticalEnd,
        keywords: 'überblick',
      },
      {
        id: 'articles',
        label: 'Beiträge',
        description: 'Prüfen und freigeben',
        to: routes.articles,
        icon: Newspaper,
        keywords: 'artikel nachrichten',
      },
      {
        id: 'sources',
        label: 'Quellen',
        description: 'Feeds und Kanäle',
        to: routes.sources,
        icon: Rss,
        keywords: 'rss feed youtube kanal',
      },
      {
        id: 'source-health',
        label: 'Quellenmonitor',
        description: 'Abrufe und Fehler',
        to: routes.sourceHealth,
        icon: HeartPulse,
        keywords: 'status fehler monitor',
      },
      {
        id: 'youtube-library',
        label: 'YouTube-Redaktion',
        description: 'Videos und Kategorien',
        to: routes.youtubeVideos,
        icon: Video,
        keywords: 'youtube video kategorie',
      },
    ],
  },
  {
    id: 'library',
    label: 'Mediathek',
    description: 'Bilder, Audio, Video und Einspieler',
    to: routes.media,
    icon: Library,
    accent: 'violet',
    keywords: 'medien bilder audio video tts musik intro outro logo trailer',
    matches: [routes.media],
    children: [
      {
        id: 'assets',
        label: 'Alle Medien',
        description: 'Zentrale Asset-Bibliothek',
        to: routes.media,
        icon: Images,
        keywords: 'bilder dateien assets',
      },
      {
        id: 'media-engine',
        label: 'Medien-Engine',
        description: 'Recherche und Verarbeitung',
        to: routes.mediaSettings,
        icon: Film,
        keywords: 'ffmpeg wikimedia pexels pixabay',
      },
    ],
  },
  {
    id: 'shorts',
    label: 'YouTube Shorts Creator',
    description: 'AVA-Momente schneiden und veröffentlichen',
    to: routes.youtubeShorts,
    icon: Scissors,
    accent: 'cyan',
    keywords: 'youtube shorts vertical ava clip upload social video',
    matches: [routes.youtubeShorts],
    children: [],
  },
  {
    id: 'schedule',
    label: 'Sendungsplanung',
    description: '24-Stunden-Programm und Sendelisten',
    to: routes.broadcast,
    icon: CalendarDays,
    accent: 'amber',
    keywords: 'sendeplan kalender timeline playlist sendung serie wiederholung',
    matches: [routes.broadcast],
    children: [
      {
        id: 'schedule-all',
        label: 'Programmplan',
        description: 'Timeline und Sendungen',
        to: routes.broadcast,
        icon: CalendarDays,
        keywords: 'plan timeline',
      },
    ],
  },
  {
    id: 'control',
    label: 'Regie',
    description: 'Preview, Programm und Live-Produktion',
    to: routes.live,
    icon: Clapperboard,
    accent: 'red',
    keywords: 'regie live preview programm szene audio breaking news reaction',
    matches: [routes.live],
    children: [
      {
        id: 'live-control',
        label: 'Live-Regie',
        description: 'Preview und Programm steuern',
        to: routes.live,
        icon: MonitorPlay,
        keywords: 'live take transition',
      },
    ],
  },
  {
    id: 'streaming',
    label: 'Livestream',
    description: 'OBS, Ziele und Verbindungsqualität',
    to: routes.obs,
    icon: RadioTower,
    accent: 'rose',
    keywords: 'obs youtube twitch rtmp bitrate dropped frames stream',
    matches: [routes.obs],
    children: [
      {
        id: 'stream-control',
        label: 'Stream & OBS',
        description: 'Ausgabe und Ziele',
        to: routes.obs,
        icon: MonitorUp,
        keywords: 'obs websocket stream ziel',
      },
    ],
  },
  {
    id: 'overlays',
    label: 'Overlays',
    description: 'Grafikdesign und Einblendungen',
    to: routes.overlays,
    icon: Files,
    accent: 'pink',
    keywords: 'overlay bauchbinde ticker logo animation designer',
    matches: [routes.overlays],
    children: [
      {
        id: 'overlay-library',
        label: 'Designbibliothek',
        description: 'Overlays und Vorlagen',
        to: routes.overlays,
        icon: Files,
        keywords: 'overlay vorlage',
      },
    ],
  },
  {
    id: 'ai',
    label: 'KI Studio',
    description: 'Modelle, Sprache und KI-Werkzeuge',
    to: routes.aiStudio,
    icon: BrainCircuit,
    accent: 'purple',
    keywords: 'ki ai openrouter openai anthropic gemini ollama qwen whisper piper tts stt',
    matches: [routes.aiStudio],
    children: [
      {
        id: 'ai-center',
        label: 'KI-Zentrale',
        description: 'Modelle und Aufgaben',
        to: routes.aiStudio,
        icon: Sparkles,
        keywords: 'modelle prompts',
      },
    ],
  },
  {
    id: 'automation',
    label: 'Automation',
    description: 'Autopilot, Regeln und Zeitpläne',
    to: routes.automation,
    icon: Bot,
    accent: 'green',
    keywords: 'autopilot regeln trigger zeitplan automatisch sendung',
    matches: [routes.automation],
    children: [
      {
        id: 'autopilot',
        label: 'Autopilot',
        description: 'Programm automatisch betreiben',
        to: routes.automation,
        icon: Bot,
        keywords: 'automatik regeln',
      },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    description: 'Reichweite, Betrieb und Qualität',
    to: routes.analytics,
    icon: BarChart3,
    accent: 'teal',
    keywords: 'statistik youtube twitch cpu ram obs reichweite',
    matches: [routes.analytics],
    children: [
      {
        id: 'analytics-overview',
        label: 'Studio Analytics',
        description: 'Leistung und Reichweite',
        to: routes.analytics,
        icon: BarChart3,
        keywords: 'diagramm statistik',
      },
    ],
  },
  {
    id: 'system',
    label: 'System',
    description: 'Konfiguration, Sicherheit und Wartung',
    to: routes.system,
    icon: Settings2,
    accent: 'slate',
    keywords: 'einstellungen server backup updates benutzer sicherheit diagnose',
    matches: [
      routes.system,
      routes.settings,
      routes.notifications,
      routes.mediaSettings,
      routes.adminUsers,
      routes.adminAudit,
      routes.adminSessions,
    ],
    children: [
      {
        id: 'control-center',
        label: 'Control Center',
        description: 'Alle Systemeinstellungen',
        to: routes.system,
        icon: Settings2,
        keywords: 'einstellungen setup',
      },
      {
        id: 'incidents',
        label: 'Störungszentrum',
        description: 'Warnungen und Fehler',
        to: routes.notifications,
        icon: BellRing,
        keywords: 'fehler alarm',
      },
      {
        id: 'users',
        label: 'Benutzer',
        description: 'Konten und Rollen',
        to: routes.adminUsers,
        icon: Users,
        keywords: 'rollen konto',
        permission: 'users:write',
      },
      {
        id: 'sessions',
        label: 'Sicherheit',
        description: 'Sitzungen und Zugriffe',
        to: routes.adminSessions,
        icon: ShieldCheck,
        keywords: 'login token',
        permission: 'users:write',
      },
      {
        id: 'audit',
        label: 'Protokoll',
        description: 'Änderungen nachvollziehen',
        to: routes.adminAudit,
        icon: FileClock,
        keywords: 'audit historie',
        permission: 'users:write',
      },
    ],
  },
];

function cleanPath(pathname: string) {
  return pathname.split(/[?#]/, 1)[0];
}

export function workspaceForPath(pathname: string) {
  const path = cleanPath(pathname);
  return (
    workspaces.find((workspace) => workspace.matches.some((match) => path === match || path.startsWith(`${match}/`))) ??
    workspaces[0]
  );
}

export function allWorkspaceCommands() {
  return workspaces.flatMap((workspace) => [workspace, ...workspace.children]);
}
