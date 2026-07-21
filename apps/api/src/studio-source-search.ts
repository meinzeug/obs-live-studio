import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PROJECT_ROOT } from './project-root.js';

const execFileAsync = promisify(execFile);

const ROUTES = {
  '/overview': ['Übersicht', 'Studiostatus und zentrale Funktionen'],
  '/newsroom': ['Newsroom', 'Redaktionsdesk, Recherche und News erstellen'],
  '/sources': ['Quellen', 'Feeds, Webseiten und YouTube-Kanäle'],
  '/source-health': ['Quellenmonitor', 'Abrufe, Fehler und Quellenzustand'],
  '/articles': ['Beiträge', 'Nachrichten bearbeiten, freigeben und löschen'],
  '/youtube-videos': ['YouTube-Videos', 'Videobibliothek, Kanäle und Kategorien'],
  '/youtube-shorts': ['YouTube Shorts Creator', 'Shorts planen, vertonen, rendern und hochladen'],
  '/tiktok-shorts': ['TikTok Shorts Creator', 'TikTok-Clips und Freigabewarteschlange'],
  '/broadcast': ['Sendungsplanung', 'Sendeformate, Programmplan und Sendelisten'],
  '/live': ['Live-Regie', 'Preview, Programm, Quellen, Reaction und Übergänge'],
  '/overlays': ['Overlays', 'Designbibliothek, Editor und Einblendungen'],
  '/media': ['Mediathek', 'Bilder, Videos, Audio und Einspieler'],
  '/obs': ['Stream & OBS', 'Szenen, Audio, Streaming-Ziele und Multistream'],
  '/ai-studio': ['KI Studio', 'Agenten, OpenRouter, Stimmen und KI-Aufträge'],
  '/automation': ['Automation', 'Autopilot, Regeln und Zeitpläne'],
  '/analytics': ['Analytics', 'Reichweite, Wachstum und Betriebsqualität'],
  '/notifications': ['Störungscenter', 'Fehler, Warnungen und automatische Fallbacks'],
  '/settings': ['Sender-Einstellungen', 'Senderprofil, Einrichtung und Integrationen'],
  '/settings/media': ['Medien-Engine', 'YouTube, Wikimedia, Pexels, Pixabay und Medienautomatik'],
  '/system': ['System', 'Dienste, Diagnose, Backup, Updates und Sicherheit'],
  '/admin/users': ['Benutzer', 'Konten, Rollen und Berechtigungen'],
  '/admin/audit': ['Audit-Protokoll', 'Administrative Änderungen nachvollziehen'],
  '/admin/sessions': ['Sitzungen', 'Aktive Anmeldungen und Geräte verwalten'],
} as const;

type StudioRoute = keyof typeof ROUTES;

const PAGE_ROUTES: Record<string, StudioRoute[]> = {
  DashboardPage: ['/overview'],
  NewsroomPage: ['/newsroom'],
  SourcesPage: ['/sources'],
  SourceHealthPage: ['/source-health'],
  ArticlesPage: ['/articles'],
  ArticleDetailRoutePage: ['/articles'],
  YoutubeVideosPage: ['/youtube-videos'],
  YoutubeShortsPage: ['/youtube-shorts'],
  TikTokShortsPage: ['/tiktok-shorts'],
  BroadcastPage: ['/broadcast'],
  LivePage: ['/live'],
  OverlaysPage: ['/overlays'],
  OverlayEditorRoutePage: ['/overlays'],
  MediaPage: ['/media'],
  MediaDetailPage: ['/media'],
  ObsPage: ['/obs'],
  AiStudioPage: ['/ai-studio'],
  AutomationPage: ['/automation'],
  AnalyticsPage: ['/analytics'],
  NotificationsPage: ['/notifications'],
  SettingsPage: ['/settings'],
  MediaSettingsPage: ['/settings/media'],
  SystemPage: ['/system'],
  AdminUsersPage: ['/admin/users'],
  AdminAuditPage: ['/admin/audit'],
  AdminSessionsPage: ['/admin/sessions'],
};

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.sql',
  '.css',
  '.scss',
  '.html',
  '.yml',
  '.yaml',
  '.toml',
  '.sh',
  '.service',
]);

const EXCLUDED_PATH_PARTS = /(^|\/)(?:node_modules|dist|coverage|var|\.git|\.cache)(?:\/|$)/;
const EXCLUDED_FILES = /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|\.env(?:\..*)?)$/;

export type StudioSourceDocument = {
  routes: StudioRoute[];
  searchable: string;
  sourceKind: 'WebUI' | 'Backend' | 'Dokumentation' | 'Betrieb' | 'Tests';
  weight: number;
};

export type StudioSourceSearchResult = {
  id: string;
  to: StudioRoute;
  label: string;
  description: string;
  score: number;
  matchCount: number;
  sourceKinds: string[];
  matchedTerms: string[];
};

function normalizedText(value: string) {
  return value
    .replace(/([a-zäöüß0-9])([A-ZÄÖÜ])/g, '$1 $2')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('de-DE')
    .replace(/[_./:@#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueRoutes(routes: StudioRoute[]) {
  return [...new Set(routes)];
}

export function routesForSourceFile(file: string): StudioRoute[] {
  const clean = file.replaceAll('\\', '/');
  const name = basename(clean, extname(clean));
  if (PAGE_ROUTES[name]) return PAGE_ROUTES[name]!;
  if (clean.endsWith('/components/ShortsPremiumSettings.tsx')) return ['/youtube-shorts', '/tiktok-shorts'];
  if (/shorts-premium/i.test(clean)) return ['/youtube-shorts', '/tiktok-shorts'];
  if (/OnboardingWizard|channel-identity|stream-target/i.test(clean)) return ['/settings', '/obs'];
  if (/Overlay|overlay/i.test(clean)) return ['/overlays'];
  if (/tiktok-short/i.test(clean)) return ['/tiktok-shorts'];
  if (/youtube-short/i.test(clean)) return ['/youtube-shorts'];
  if (/youtube-(?:video|channel|transcript)/i.test(clean)) return ['/youtube-videos'];
  if (/youtube-(?:oauth|live-chat)|twitch|streaming-platform|multi-rtmp|multistream|rtmp-output/i.test(clean))
    return ['/obs'];
  if (/ai-(?:provider|studio|staff|team|host|presenter)|openrouter|tts|piper|pocket-tts|qwen/i.test(clean))
    return ['/ai-studio'];
  if (/broadcast-format|broadcast-planner|broadcast-engine|playlist|schedule/i.test(clean)) return ['/broadcast'];
  if (/autopilot|automation/i.test(clean)) return ['/automation'];
  if (/live-(?:studio|regie|reaction|source)|reaction-mode/i.test(clean)) return ['/live'];
  if (/article-media|media-(?:engine|discovery|download|research|runtime)|ffmpeg/i.test(clean))
    return ['/settings/media', '/media'];
  if (/article|editorial|newsroom/i.test(clean)) return ['/articles', '/newsroom'];
  if (/source-health|source-update|source-url/i.test(clean)) return ['/source-health', '/sources'];
  if (/source|feed|news-parser/i.test(clean)) return ['/sources'];
  if (/growth|analytics/i.test(clean)) return ['/analytics'];
  if (/notification|incident|fallback/i.test(clean)) return ['/notifications'];
  if (/obs-controller|desktop-agent|obs-/i.test(clean)) return ['/obs'];
  if (/auth|security|session|user/i.test(clean)) return ['/admin/users', '/admin/sessions', '/system'];
  if (/backup|systemd|install|preflight|health|configuration|config/i.test(clean)) return ['/system'];
  if (clean.startsWith('docs/')) return ['/system'];
  if (clean.startsWith('apps/web/src/components/')) return ['/overview'];
  return ['/system'];
}

function sourceKind(file: string): StudioSourceDocument['sourceKind'] {
  if (file.startsWith('apps/web/')) return 'WebUI';
  if (file.startsWith('docs/') || file.endsWith('.md')) return 'Dokumentation';
  if (file.startsWith('tests/')) return 'Tests';
  if (file.startsWith('scripts/') || file.includes('systemd') || file.endsWith('.service')) return 'Betrieb';
  return 'Backend';
}

function sourceWeight(kind: StudioSourceDocument['sourceKind']) {
  if (kind === 'WebUI') return 10;
  if (kind === 'Backend') return 5;
  if (kind === 'Dokumentation') return 3;
  if (kind === 'Betrieb') return 2;
  return 1;
}

async function repositoryFilesFallback(root: string) {
  const files: string[] = [];
  const walk = async (directory: string, prefix = '') => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (EXCLUDED_PATH_PARTS.test(relativePath) || EXCLUDED_FILES.test(relativePath)) continue;
      if (entry.isDirectory()) await walk(join(directory, entry.name), relativePath);
      else if (entry.isFile()) files.push(relativePath);
    }
  };
  await walk(root);
  return files;
}

async function trackedFiles(root: string) {
  try {
    const result = await execFileAsync(
      'git',
      ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return String(result.stdout).split('\0').filter(Boolean);
  } catch {
    // Production bundles do not always contain .git. The same guarded text-file
    // scan keeps Studio Search useful without indexing secrets or build output.
    return repositoryFilesFallback(root);
  }
}

function searchableSourceFile(file: string) {
  if (EXCLUDED_PATH_PARTS.test(file) || EXCLUDED_FILES.test(file)) return false;
  return (
    TEXT_EXTENSIONS.has(extname(file).toLowerCase()) || ['Dockerfile', 'Makefile', 'README'].includes(basename(file))
  );
}

export async function buildStudioSourceIndex(root = PROJECT_ROOT) {
  const files = (await trackedFiles(root)).filter(searchableSourceFile);
  const documents: StudioSourceDocument[] = [];
  for (const file of files) {
    const absolute = resolve(root, file);
    const info = await stat(absolute).catch(() => null);
    if (!info?.isFile() || info.size > 1024 * 1024) continue;
    const content = await readFile(absolute, 'utf8').catch(() => '');
    if (!content || content.includes('\0')) continue;
    const kind = sourceKind(file);
    const searchable = normalizedText(`${file}\n${content}`);
    if (!searchable) continue;
    documents.push({
      routes: uniqueRoutes(routesForSourceFile(file)),
      searchable,
      sourceKind: kind,
      weight: sourceWeight(kind),
    });
  }
  return { documents, indexedFiles: documents.length, indexedAt: new Date().toISOString() };
}

function occurrences(haystack: string, needle: string) {
  if (!needle) return 0;
  let count = 0;
  let position = 0;
  while (count < 50 && (position = haystack.indexOf(needle, position)) >= 0) {
    count += 1;
    position += Math.max(1, needle.length);
  }
  return count;
}

export function searchStudioSourceDocuments(documents: StudioSourceDocument[], query: string, limit = 12) {
  const phrase = normalizedText(query).slice(0, 160);
  const terms = [...new Set(phrase.split(' ').filter((term) => term.length >= 2))].slice(0, 12);
  if (!terms.length) return [];
  const aggregates = new Map<StudioRoute, { score: number; count: number; kinds: Set<string>; terms: Set<string> }>();
  for (const document of documents) {
    if (!terms.every((term) => document.searchable.includes(term))) continue;
    const phraseCount = phrase.includes(' ') ? occurrences(document.searchable, phrase) : 0;
    const termCount = terms.reduce((sum, term) => sum + occurrences(document.searchable, term), 0);
    const score = document.weight * (termCount + phraseCount * 8 + terms.length * 3);
    for (const route of document.routes) {
      const current = aggregates.get(route) ?? { score: 0, count: 0, kinds: new Set(), terms: new Set() };
      current.score += score;
      current.count += termCount;
      current.kinds.add(document.sourceKind);
      terms.forEach((term) => current.terms.add(term));
      aggregates.set(route, current);
    }
  }
  return [...aggregates.entries()]
    .map(([to, value]): StudioSourceSearchResult => ({
      id: `source-${to.slice(1).replaceAll('/', '-') || 'overview'}`,
      to,
      label: ROUTES[to][0],
      description: ROUTES[to][1],
      score: Math.round(value.score),
      matchCount: value.count,
      sourceKinds: [...value.kinds],
      matchedTerms: [...value.terms],
    }))
    .sort(
      (left, right) =>
        right.score - left.score || right.matchCount - left.matchCount || left.label.localeCompare(right.label, 'de'),
    )
    .slice(0, Math.max(1, Math.min(30, limit)));
}

let sourceIndexPromise: ReturnType<typeof buildStudioSourceIndex> | null = null;

export function registerStudioSourceSearchRoutes(app: FastifyInstance) {
  app.get('/api/studio-search', async (request) => {
    const input = z
      .object({ q: z.string().trim().min(2).max(160), limit: z.coerce.number().int().min(1).max(30).default(12) })
      .parse(request.query);
    sourceIndexPromise ??= buildStudioSourceIndex();
    const index = await sourceIndexPromise;
    return {
      query: input.q,
      results: searchStudioSourceDocuments(index.documents, input.q, input.limit),
      index: { files: index.indexedFiles, indexedAt: index.indexedAt, scope: 'tracked-source-without-secrets' },
    };
  });
}
