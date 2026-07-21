import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import dotenv from 'dotenv';
import { z } from 'zod';
import { auditLog } from '@ans/database/auth';
import { getOpenRouterBudgetSummary } from '@ans/database/ai-usage';
import {
  getShortsPremiumSettings,
  getShortsQualityUpgradeStatus,
  queueFallbackShortsForElevenLabsUpgrade,
  updateShortsPremiumSettings,
} from '@ans/database/shorts-premium';
import { resolveOperationalNotification, upsertOperationalNotification } from '@ans/database/notifications';
import { resolveOpenRouterConfig } from '@ans/ai-provider';
import { maskSecret } from '@ans/security';
import { DEFAULT_ELEVENLABS_MODEL, DEFAULT_ELEVENLABS_OUTPUT_FORMAT, synthesizeElevenLabs } from '@ans/tts-engine';
import type { WritePermission } from '@ans/security/auth';
import { updateEnvironmentDocument } from './stream-target-settings.js';
import {
  readOptionalEnvironmentFile,
  withEnvironmentFileLock,
  writePrivateEnvironmentFile,
} from './environment-file.js';
import { PROJECT_ROOT } from './project-root.js';

type RequirePermission = (request: FastifyRequest, reply: FastifyReply, permission: WritePermission) => unknown;

const settingsSchema = z
  .object({
    elevenlabsEnabled: z.boolean().optional(),
    elevenlabsApiKey: z.string().trim().max(500).optional(),
    clearElevenlabsApiKey: z.boolean().optional(),
    elevenlabsVoiceId: z.string().trim().max(200).optional(),
    elevenlabsVoiceName: z.string().trim().max(200).optional(),
    elevenlabsModelId: z.string().trim().min(2).max(200).optional(),
    elevenlabsOutputFormat: z.enum(['mp3_44100_128', 'mp3_44100_192']).optional(),
    elevenlabsStability: z.number().min(0).max(1).optional(),
    elevenlabsSimilarityBoost: z.number().min(0).max(1).optional(),
    elevenlabsStyle: z.number().min(0).max(1).optional(),
    elevenlabsSpeakerBoost: z.boolean().optional(),
    localTtsFallback: z.boolean().optional(),
    paidLlmEnabled: z.boolean().optional(),
    paidLlmModelStrategy: z.enum(['automatic', 'fixed']).optional(),
    paidLlmModel: z.string().trim().max(300).optional(),
    paidLlmMaxRequestUsd: z.number().min(0.01).max(25).optional(),
    paidLlmDailyBudgetUsd: z.number().min(0.01).max(1000).optional(),
    editorialInstructions: z.string().trim().min(10).max(3000).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.paidLlmModelStrategy === 'fixed' && !input.paidLlmModel)
      context.addIssue({
        code: 'custom',
        path: ['paidLlmModel'],
        message: 'Für die feste Strategie fehlt die Model-ID.',
      });
    if (input.paidLlmModel && (input.paidLlmModel === 'openrouter/free' || input.paidLlmModel.includes(':free')))
      context.addIssue({
        code: 'custom',
        path: ['paidLlmModel'],
        message: 'Die Premium-Shorts-Redaktion akzeptiert ausschließlich bezahlte Modelle.',
      });
  });

const voiceTestSchema = z
  .object({
    text: z.string().trim().min(3).max(600),
    voiceId: z.string().trim().min(2).max(200).optional(),
  })
  .strict();

type ElevenLabsVoice = {
  voice_id?: unknown;
  name?: unknown;
  category?: unknown;
  description?: unknown;
  preview_url?: unknown;
  labels?: unknown;
};

function safeElevenLabsError(payload: unknown, status: number) {
  const detail =
    payload && typeof payload === 'object' && 'detail' in payload
      ? typeof (payload as { detail?: unknown }).detail === 'string'
        ? (payload as { detail: string }).detail
        : String((payload as { detail?: { message?: unknown } }).detail?.message ?? '')
      : '';
  return detail.trim() ? detail.replace(/[\r\n]+/g, ' ').slice(0, 500) : `ElevenLabs HTTP ${status}`;
}

export class ShortsPremiumSettingsManager {
  private readonly envFile: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: { envFile?: string; env?: NodeJS.ProcessEnv } = {}) {
    this.envFile = options.envFile ?? resolve(PROJECT_ROOT, '.env');
    this.env = options.env ?? process.env;
  }

  async environment() {
    const content = await readOptionalEnvironmentFile(this.envFile);
    return { content, env: { ...this.env, ...dotenv.parse(content) } };
  }

  async saveApiKey(apiKey: string | undefined, clear: boolean) {
    if (apiKey === undefined && !clear) return;
    await withEnvironmentFileLock(this.envFile, async () => {
      const { content } = await this.environment();
      const value = clear ? '' : (apiKey?.trim() ?? '');
      await writePrivateEnvironmentFile(
        this.envFile,
        updateEnvironmentDocument(content, { ELEVENLABS_API_KEY: value }),
      );
      this.env.ELEVENLABS_API_KEY = value;
    });
  }

  async publicStatus() {
    const { env } = await this.environment();
    const key = env.ELEVENLABS_API_KEY?.trim() ?? '';
    const openRouter = resolveOpenRouterConfig(env);
    return {
      elevenlabs: { configured: Boolean(key), apiKeyHint: key ? maskSecret(key) : '' },
      openrouter: {
        configured: Boolean(openRouter.apiKey),
        apiKeyHint: openRouter.apiKey ? maskSecret(openRouter.apiKey) : '',
      },
    };
  }

  async elevenLabsKey() {
    return (await this.environment()).env.ELEVENLABS_API_KEY?.trim() ?? '';
  }
}

async function elevenLabsJson(path: string, apiKey: string) {
  const response = await fetch(`https://api.elevenlabs.io${path}`, {
    headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) throw Object.assign(new Error(safeElevenLabsError(payload, response.status)), { statusCode: 502 });
  return payload;
}

async function elevenLabsDiagnostic(apiKey: string) {
  if (!apiKey) throw Object.assign(new Error('ElevenLabs API-Key fehlt.'), { statusCode: 409 });
  const [subscription, voicePayload, modelsPayload] = await Promise.all([
    elevenLabsJson('/v1/user/subscription', apiKey),
    elevenLabsJson('/v2/voices?page_size=100', apiKey),
    elevenLabsJson('/v1/models', apiKey),
  ]);
  const voiceObject = voicePayload as { voices?: ElevenLabsVoice[] };
  const voices = (Array.isArray(voiceObject.voices) ? voiceObject.voices : [])
    .map((voice) => ({
      id: typeof voice.voice_id === 'string' ? voice.voice_id : '',
      name: typeof voice.name === 'string' ? voice.name : 'Unbenannte Stimme',
      category: typeof voice.category === 'string' ? voice.category : '',
      description: typeof voice.description === 'string' ? voice.description : '',
      previewUrl: typeof voice.preview_url === 'string' ? voice.preview_url : '',
      labels: voice.labels && typeof voice.labels === 'object' && !Array.isArray(voice.labels) ? voice.labels : {},
    }))
    .filter((voice) => voice.id)
    .sort((left, right) => left.name.localeCompare(right.name, 'de'));
  const models = (Array.isArray(modelsPayload) ? modelsPayload : [])
    .filter(
      (model) =>
        model && typeof model === 'object' && (model as { can_do_text_to_speech?: unknown }).can_do_text_to_speech,
    )
    .map((model) => ({
      id: String((model as { model_id?: unknown }).model_id ?? ''),
      name: String((model as { name?: unknown }).name ?? ''),
      languages: Array.isArray((model as { languages?: unknown }).languages)
        ? (model as { languages: unknown[] }).languages.filter(
            (language): language is string => typeof language === 'string',
          )
        : [],
    }))
    .filter((model) => model.id);
  const plan = subscription && typeof subscription === 'object' ? (subscription as Record<string, unknown>) : {};
  return {
    connected: true,
    subscription: {
      tier: typeof plan.tier === 'string' ? plan.tier : '',
      status: typeof plan.status === 'string' ? plan.status : '',
      characterCount: Number(plan.character_count ?? 0),
      characterLimit: Number(plan.character_limit ?? 0),
    },
    voices,
    models,
  };
}

async function validateElevenLabsUpgrade(apiKey: string, voiceId: string) {
  if (!apiKey) throw new Error('ElevenLabs API-Key fehlt.');
  if (!voiceId) throw new Error('ElevenLabs Stimme fehlt.');
  const voice = (await elevenLabsJson(`/v1/voices/${encodeURIComponent(voiceId)}`, apiKey)) as {
    voice_id?: unknown;
    name?: unknown;
  };
  if (String(voice.voice_id ?? '') !== voiceId)
    throw new Error('Die ausgewählte ElevenLabs-Stimme ist mit diesem Zugang nicht verfügbar.');
  return { id: voiceId, name: typeof voice.name === 'string' ? voice.name : '' };
}

export function registerShortsPremiumRoutes(
  app: FastifyInstance,
  requirePermission: RequirePermission,
  manager = new ShortsPremiumSettingsManager(),
) {
  app.get('/api/shorts-premium', async () => {
    const settings = await getShortsPremiumSettings();
    const [connections, budget, qualityUpgrade] = await Promise.all([
      manager.publicStatus(),
      getOpenRouterBudgetSummary(settings.paid_llm_daily_budget_usd, settings.paid_llm_max_request_usd),
      getShortsQualityUpgradeStatus(),
    ]);
    return {
      settings,
      connections,
      budget,
      qualityUpgrade,
      defaults: { modelId: DEFAULT_ELEVENLABS_MODEL, outputFormat: DEFAULT_ELEVENLABS_OUTPUT_FORMAT },
      docs: {
        elevenlabsTts: 'https://elevenlabs.io/docs/api-reference/text-to-speech/convert',
        elevenlabsVoices: 'https://elevenlabs.io/docs/api-reference/voices/search',
        openrouterModels: 'https://openrouter.ai/models',
      },
    };
  });

  app.patch('/api/shorts-premium/settings', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const input = settingsSchema.parse(request.body ?? {});
    await manager.saveApiKey(input.elevenlabsApiKey, input.clearElevenlabsApiKey === true);
    const settingsInput = { ...input };
    delete settingsInput.elevenlabsApiKey;
    delete settingsInput.clearElevenlabsApiKey;
    const settings = await updateShortsPremiumSettings(settingsInput);
    const key = await manager.elevenLabsKey();
    const elevenLabsChanged =
      input.elevenlabsApiKey !== undefined ||
      input.clearElevenlabsApiKey === true ||
      input.elevenlabsEnabled !== undefined ||
      input.elevenlabsVoiceId !== undefined;
    let qualityUpgrade: {
      state: 'unchanged' | 'waiting' | 'queued';
      message: string;
      queued: { youtube: number; tiktok: number; total: number };
    } = {
      state: 'unchanged',
      message: 'Die bestehende Audio-Pipeline bleibt unverändert.',
      queued: { youtube: 0, tiktok: 0, total: 0 },
    };
    if (elevenLabsChanged && settings.elevenlabs_enabled) {
      try {
        const voice = await validateElevenLabsUpgrade(key, settings.elevenlabs_voice_id.trim());
        const queued = await queueFallbackShortsForElevenLabsUpgrade();
        qualityUpgrade = {
          state: 'queued',
          message:
            queued.total > 0
              ? `${queued.total} noch nicht veröffentlichte Fallback-Shorts werden automatisch mit ${voice.name || 'der gewählten ElevenLabs-Stimme'} neu vertont.`
              : 'ElevenLabs ist bereit. Neue Shorts werden ab jetzt automatisch hochwertig vertont.',
          queued,
        };
        await resolveOperationalNotification('shorts-premium:elevenlabs-setup').catch(() => null);
        if (queued.total > 0)
          await upsertOperationalNotification({
            level: 'info',
            component: 'shorts-premium',
            dedupeKey: 'shorts-premium:hq-upgrade',
            message: `${queued.total} Shorts werden nach der ElevenLabs-Aktivierung automatisch hochwertig neu vertont.`,
            details: queued,
          }).catch(() => null);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        qualityUpgrade = {
          state: 'waiting',
          message: `Lokales TTS bleibt aktiv. Die automatische HQ-Nachrüstung startet, sobald ElevenLabs bereit ist: ${errorMessage}`,
          queued: { youtube: 0, tiktok: 0, total: 0 },
        };
        await upsertOperationalNotification({
          level: 'warning',
          component: 'shorts-premium',
          dedupeKey: 'shorts-premium:elevenlabs-setup',
          message: 'ElevenLabs ist noch nicht vollständig sendebereit; Shorts verwenden weiterhin lokales TTS.',
          details: { error: errorMessage, fallbackActive: settings.local_tts_fallback },
        }).catch(() => null);
      }
    }
    await auditLog(request.user?.id ?? null, 'shorts_premium.settings.update', 'shorts_premium_settings', undefined, {
      fields: Object.keys(settingsInput),
      elevenlabsKeyChanged: input.elevenlabsApiKey !== undefined || input.clearElevenlabsApiKey === true,
      qualityUpgrade,
    });
    return { settings, connections: await manager.publicStatus(), qualityUpgrade };
  });

  app.post('/api/shorts-premium/elevenlabs/diagnose', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    return elevenLabsDiagnostic(await manager.elevenLabsKey());
  });

  app.post('/api/shorts-premium/elevenlabs/test-voice', async (request, reply) => {
    requirePermission(request, reply, 'users:write');
    const input = voiceTestSchema.parse(request.body ?? {});
    const settings = await getShortsPremiumSettings();
    const voiceId = input.voiceId || settings.elevenlabs_voice_id;
    const generated = await synthesizeElevenLabs(input.text, {
      apiKey: await manager.elevenLabsKey(),
      voiceId,
      modelId: settings.elevenlabs_model_id,
      outputFormat: settings.elevenlabs_output_format,
      stability: settings.elevenlabs_stability,
      similarityBoost: settings.elevenlabs_similarity_boost,
      style: settings.elevenlabs_style,
      speakerBoost: settings.elevenlabs_speaker_boost,
      outputGainDb: 2,
      outputDirectory: resolve(PROJECT_ROOT, 'var/tts/shorts-tests'),
      ffmpegExecutable: process.env.FFMPEG_EXECUTABLE || 'ffmpeg',
    });
    return {
      audioUrl: `/api/shorts-premium/test-audio/${encodeURIComponent(basename(generated.file))}`,
      cached: generated.cached,
      voice: generated.voice,
      model: generated.modelPath,
      characterCost: generated.characterCost,
    };
  });

  app.get('/api/shorts-premium/test-audio/:file', async (request, reply) => {
    const { file } = z.object({ file: z.string().regex(/^[a-f0-9]{64}\.wav$/) }).parse(request.params);
    const path = resolve(PROJECT_ROOT, 'var/tts/shorts-tests', file);
    await access(path);
    reply.type('audio/wav').header('Cache-Control', 'private, max-age=3600');
    return reply.send(createReadStream(path));
  });
}
