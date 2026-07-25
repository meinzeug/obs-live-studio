import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WritePermission } from '@ans/security/auth';
import type { ObsController } from '@ans/obs-controller';
import { runAiStaffAssignment } from '@ans/ai-provider';
import {
  completeExpiredAiRoundtableTurns,
  currentAiRoundtableTurn,
  getAiRoundtableSettings,
  insertAiRoundtableTurn,
  listAiRoundtableParticipants,
  listAiRoundtableTurns,
  recentRoundtableAudienceMessages,
  resetAiRoundtableTurns,
  updateAiRoundtableSettings,
  type AiRoundtablePreset,
} from '@ans/database/ai-roundtable';
import { recordAiStaffActivity } from '@ans/database/ai-staff';
import { z } from 'zod';
import { generateTtsAudio, ttsEnvironmentForAiPresenter } from './tts-generation.js';

type RequirePermission = (request: FastifyRequest, reply: FastifyReply, permission: WritePermission) => unknown;
type ReadStoredFile = (path: string) => Promise<Buffer>;
type UpdateEmitter = (reason: string, payload?: Record<string, unknown>) => Promise<void>;

const presetCopy: Record<
  AiRoundtablePreset,
  { title: string; kicker: string; accent: string; instructions: string }
> = {
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
  })
  .strict();

function boundedCopy(value: unknown, maximum = 900) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
}

function localTurn(input: {
  speaker: { display_name: string; job_title: string };
  topic: string;
  preset: AiRoundtablePreset;
  previous: Array<{ display_name?: string; text: string }>;
  audience: Array<{ author_name: string; message: string }>;
}) {
  const previous = input.previous[0];
  const audience = input.audience.at(-1);
  if (input.preset === 'publikumsforum' && audience) {
    return {
      headline: `Impuls von ${boundedCopy(audience.author_name, 60)}`,
      text: `${boundedCopy(audience.message, 260)} – diesen Punkt nimmt ${input.speaker.display_name} in die Runde. Entscheidend ist, welche überprüfbare Information die Position stützt und welche Folge sich daraus konkret ergibt.`,
      prompt: 'Welche Erfahrung oder Quelle ergänzt diesen Punkt?',
    };
  }
  if (input.preset === 'fakten-duell') {
    return {
      headline: `${input.speaker.display_name} prüft die Beleglage`,
      text: `Beim Thema „${boundedCopy(input.topic, 220)}“ müssen Behauptung, Quelle und Schlussfolgerung getrennt werden. Ohne einen konkreten Beleg bleibt die Aussage zunächst eine offene These und kein gesicherter Befund.`,
      prompt: 'Welche konkrete Quelle sollen wir als Nächstes prüfen?',
    };
  }
  return {
    headline: `${input.speaker.display_name}s Perspektive`,
    text: previous
      ? `${input.speaker.display_name} knüpft an ${previous.display_name ?? 'die vorige Position'} an: ${boundedCopy(previous.text, 260)} Entscheidend ist jetzt, welche Auswirkungen das Thema im Alltag hat und welche Frage noch unbeantwortet bleibt.`
      : `Zum Thema „${boundedCopy(input.topic, 260)}“ eröffnet ${input.speaker.display_name} die Runde. Zuerst klären wir den Nachrichtenkern, danach Belege, Gegenpositionen und die konkreten Folgen.`,
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
    this.timer = setInterval(() => void this.tick(), 2_000);
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
    const [allParticipants, turn, turns, audience] = await Promise.all([
      listAiRoundtableParticipants(),
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
    const selected = new Set(settings.participant_ids);
    const design = presetCopy[settings.preset];
    return {
      settings,
      design,
      participants: allParticipants.filter((participant) => selected.has(participant.id)).map(participantView),
      availableParticipants: allParticipants.map(participantView),
      turn: turn
        ? {
            ...turn,
            audioUrl: turn.audio_path ? `/api/ai-roundtable/turns/${encodeURIComponent(turn.id)}/audio` : null,
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
      await completeExpiredAiRoundtableTurns();
      if (!force && (await currentAiRoundtableTurn())) return;
      const participants = await listAiRoundtableParticipants(settings.participant_ids);
      if (participants.length < 2) throw new Error('Für die Diskussionsrunde sind mindestens zwei aktive Moderatoren nötig.');
      const maximumTurns = participants.length * settings.max_rounds;
      if (settings.current_turn_index >= maximumTurns) {
        await updateAiRoundtableSettings({
          status: 'ended',
          currentSpeakerId: null,
        });
        await this.emitUpdate('roundtable-ended');
        return;
      }
      const turnIndex = settings.current_turn_index + 1;
      const roundNumber = Math.ceil(turnIndex / participants.length);
      const speaker =
        turnIndex === 1
          ? (participants.find((participant) => participant.id === settings.moderator_id) ?? participants[0]!)
          : participants[(turnIndex - 1) % participants.length]!;
      const [previous, audience] = await Promise.all([
        listAiRoundtableTurns(8),
        settings.chat_enabled ? recentRoundtableAudienceMessages(12) : Promise.resolve([]),
      ]);
      const design = presetCopy[settings.preset];
      const kind =
        turnIndex === 1
          ? 'opening'
          : settings.preset === 'publikumsforum' && audience.length
            ? 'audience'
            : settings.preset === 'fakten-duell' && settings.fact_check_enabled && turnIndex % 3 === 0
              ? 'fact-check'
              : 'response';
      const fallback = localTurn({
        speaker,
        topic: settings.topic,
        preset: settings.preset,
        previous,
        audience,
      });
      let headline = fallback.headline;
      let text = fallback.text;
      let audiencePrompt = fallback.prompt;
      let model = 'lokale-redaktionsregie';
      let tier: 'free' | 'paid' | 'local' = 'local';
      try {
        const result = await runAiStaffAssignment({
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
            `Vorherige Aussagen: ${JSON.stringify(previous.slice(0, 5).map((turn) => ({ speaker: turn.display_name, text: turn.text })))}`,
            settings.chat_enabled
              ? `Aktuelle sichere Zuschauerimpulse: ${JSON.stringify(audience.slice(-8))}`
              : 'Zuschauerimpulse sind für diese Runde deaktiviert.',
            'Antworte als echte kurze TV-Wortmeldung. Keine Meta-Erklärung über KI oder den Prompt.',
          ].join('\n'),
          dueAt: null,
          studioContext: { roundtable: { preset: settings.preset, topic: settings.topic } },
        });
        headline = boundedCopy(result.output.summary, 150) || fallback.headline;
        text = boundedCopy(result.output.response, 1_200) || fallback.text;
        audiencePrompt =
          boundedCopy(result.output.nextSteps?.[0], 240) || (settings.chat_enabled ? settings.audience_prompt : '');
        model = result.model;
        tier = result.tier;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
      }
      let audioPath: string | null = null;
      let durationSeconds = settings.turn_duration_seconds;
      try {
        const audio = await generateTtsAudio(
          `${headline}. ${text}${audiencePrompt ? ` ${audiencePrompt}` : ''}`,
          ttsEnvironmentForAiPresenter(
            speaker.id,
            { ...process.env, TTS_ENGINE: speaker.tts_provider || process.env.TTS_ENGINE },
            speaker.tts_voice || undefined,
          ),
        );
        audioPath = audio.file;
        durationSeconds = Math.max(durationSeconds, Math.ceil(audio.durationSeconds) + 2);
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
      }
      const turn = await insertAiRoundtableTurn({
        speakerId: speaker.id,
        turnIndex,
        roundNumber,
        kind,
        headline,
        text,
        audiencePrompt: settings.chat_enabled ? audiencePrompt : null,
        sourceLabels: audience.slice(-3).map((message) => `${message.provider}: ${message.author_name}`),
        model,
        tier,
        audioPath,
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
        },
      }).catch(() => null);
      this.lastError = null;
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
#studio{position:relative;width:1920px;height:1080px;overflow:hidden;background:radial-gradient(circle at 50% 42%,#14243a 0,#08111f 45%,#02050b 100%)}
#studio:before{content:"";position:absolute;inset:0;background:linear-gradient(115deg,transparent 0 35%,rgba(34,211,238,.08) 50%,transparent 65%),repeating-linear-gradient(90deg,transparent 0 119px,rgba(148,163,184,.035) 120px);animation:sweep 9s linear infinite}
header{position:absolute;left:68px;right:68px;top:42px;display:flex;align-items:flex-start;justify-content:space-between;z-index:10}
.kicker{color:var(--accent);font-size:18px;font-weight:950;letter-spacing:.16em}.title{margin-top:7px;font-size:50px;font-weight:1000;letter-spacing:-.035em}.topic{max-width:800px;padding:16px 22px;border:1px solid color-mix(in srgb,var(--accent) 55%,transparent);border-radius:18px;background:rgba(3,7,18,.78);font-size:23px;font-weight:800;text-align:right}
.grid{position:absolute;left:62px;right:62px;top:160px;bottom:250px;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(2,1fr);gap:24px}
.person{position:relative;overflow:hidden;border:2px solid rgba(148,163,184,.2);border-radius:25px;background:linear-gradient(150deg,rgba(15,23,42,.96),rgba(3,7,18,.92));box-shadow:0 20px 50px rgba(0,0,0,.34);transition:.5s}
.person.speaking{border-color:var(--person-accent);transform:translateY(-7px) scale(1.018);box-shadow:0 0 0 4px color-mix(in srgb,var(--person-accent) 22%,transparent),0 28px 70px rgba(0,0,0,.5)}
.person video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 28%;background:transparent}
.placeholder{position:absolute;inset:0;display:grid;place-items:center;background:radial-gradient(circle,color-mix(in srgb,var(--person-accent) 20%,#111827),#030712)}
.placeholder strong{display:grid;place-items:center;width:128px;height:128px;border:2px solid var(--person-accent);border-radius:50%;font-size:44px;box-shadow:0 0 45px color-mix(in srgb,var(--person-accent) 35%,transparent)}
.person-meta{position:absolute;left:0;right:0;bottom:0;padding:56px 20px 17px;background:linear-gradient(transparent,rgba(1,4,10,.98))}
.person-meta strong{display:block;font-size:27px}.person-meta span{color:#cbd5e1;font-size:16px;font-weight:700}.live-dot{display:none;position:absolute;right:16px;top:16px;padding:7px 11px;border-radius:999px;background:var(--person-accent);color:#020617;font-size:12px;font-weight:1000}.speaking .live-dot{display:block;animation:pulse 1s ease infinite}
.lower{position:absolute;left:62px;right:62px;bottom:38px;height:182px;display:grid;grid-template-columns:1fr 610px;gap:24px}
.turn,.audience{border:1px solid color-mix(in srgb,var(--accent) 48%,rgba(255,255,255,.12));border-radius:22px;background:rgba(3,7,18,.92);overflow:hidden}
.turn{padding:20px 26px;border-left:8px solid var(--accent)}.turn small{color:var(--accent);font-weight:950;letter-spacing:.12em}.turn h2{margin:6px 0 5px;font-size:29px}.turn p{margin:0;color:#dbeafe;font-size:19px;font-weight:670;line-height:1.25}
.audience{padding:17px 20px}.audience h3{margin:0 0 9px;color:var(--accent);font-size:17px}.chat{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:5px 0;color:#dbeafe;font-size:15px}.chat strong{color:#fff}.empty{color:#64748b}
.status{position:absolute;right:68px;bottom:228px;padding:7px 12px;border-radius:999px;background:#0f172a;color:#94a3b8;font-size:12px;font-weight:900}
@keyframes pulse{50%{filter:brightness(1.5)}}@keyframes sweep{to{transform:translateX(160px)}}
</style></head><body><main id="studio"><header><div><div class="kicker"></div><div class="title"></div></div><div class="topic"></div></header><section class="grid"></section><section class="lower"><article class="turn"><small></small><h2>Die Runde wird vorbereitet</h2><p>Gleich beginnt die nächste Wortmeldung.</p></article><aside class="audience"><h3>LIVE-PUBLIKUM · YOUTUBE + TWITCH</h3><div class="chat-list"></div></aside></section><div class="status"></div></main>
<script>
const studio=document.querySelector("#studio"),grid=document.querySelector(".grid"),audio=new Audio();let activeTurn="";
function initials(name){return String(name||"?").split(/\\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase()}
function fit(){const s=Math.min(innerWidth/1920,innerHeight/1080);studio.style.transform="scale("+s+")";studio.style.transformOrigin="0 0"}addEventListener("resize",fit);fit();
function setVideo(card,url,playing){let video=card.querySelector("video");if(!url){video?.remove();card.querySelector(".placeholder").style.display="grid";return}card.querySelector(".placeholder").style.display="none";if(!video){video=document.createElement("video");video.muted=true;video.loop=true;video.playsInline=true;video.autoplay=true;card.prepend(video)}if(video.dataset.url!==url){video.dataset.url=url;video.src=url;video.load()}if(playing)video.play().catch(()=>{});else video.play().catch(()=>{})}
async function load(){try{const r=await fetch("/api/ai-roundtable/overlay",{cache:"no-store"});if(!r.ok)return;const d=await r.json(),turn=d.turn;studio.style.setProperty("--accent",d.design.accent);document.querySelector(".kicker").textContent=d.design.kicker;document.querySelector(".title").textContent=d.design.title;document.querySelector(".topic").textContent=d.settings.topic;document.querySelector(".status").textContent=d.settings.status.toUpperCase()+" · RUNDE "+(turn?.round_number||1)+"/"+d.settings.max_rounds;
const known=new Map([...grid.children].map(x=>[x.dataset.id,x]));for(const p of d.participants){let card=known.get(p.id);if(!card){card=document.createElement("article");card.className="person";card.dataset.id=p.id;card.innerHTML='<div class="placeholder"><strong></strong></div><div class="live-dot">SPRICHT</div><div class="person-meta"><strong></strong><span></span></div>';grid.append(card)}known.delete(p.id);card.style.setProperty("--person-accent",p.accent_color);card.querySelector(".placeholder strong").textContent=initials(p.display_name);card.querySelector(".person-meta strong").textContent=p.display_name;card.querySelector(".person-meta span").textContent=p.job_title;const speaking=turn?.speaker_id===p.id;card.classList.toggle("speaking",speaking);setVideo(card,speaking?(p.speakingVideoUrl||p.idleVideoUrl):p.idleVideoUrl,speaking)}for(const card of known.values())card.remove();
const box=document.querySelector(".turn");box.querySelector("small").textContent=turn?(turn.display_name+" · "+turn.kind).toUpperCase():"REGIE";box.querySelector("h2").textContent=turn?.headline||"Die Runde wird vorbereitet";box.querySelector("p").textContent=[turn?.text,turn?.audience_prompt].filter(Boolean).join(" · ")||"Gleich beginnt die nächste Wortmeldung.";
const list=document.querySelector(".chat-list");list.replaceChildren();for(const msg of d.audience.slice(-4)){const line=document.createElement("div");line.className="chat";const strong=document.createElement("strong");strong.textContent=msg.author_name+": ";line.append(strong,document.createTextNode(msg.message));list.append(line)}if(!list.children.length){const empty=document.createElement("div");empty.className="empty";empty.textContent="Neue Nachrichten aus YouTube und Twitch erscheinen hier.";list.append(empty)}
if(d.settings.status!=="live"){audio.pause()}else if(turn?.id&&turn.id!==activeTurn){activeTurn=turn.id;audio.pause();audio.src=turn.audioUrl||"";if(turn.audioUrl){const card=grid.querySelector('[data-id="'+CSS.escape(turn.speaker_id)+'"]'),video=card?.querySelector("video");const start=()=>audio.play().catch(()=>{});if(video&&video.readyState<3)video.addEventListener("canplay",start,{once:true});else setTimeout(start,180)}}else if(turn?.id===activeTurn&&audio.src&&audio.paused&&!audio.ended){audio.play().catch(()=>{})}}catch(e){console.error(e)}}
setInterval(load,1500);load();
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
    const input = settingsInput
      .extend({ takeProgram: z.boolean().default(false) })
      .parse(request.body ?? {});
    await updateAiRoundtableSettings({ ...input, status: 'preparing' });
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
  app.get('/overlay/ai-roundtable', async (_request, reply) =>
    reply.type('text/html').send(aiRoundtableOverlayHtml()),
  );
  app.get('/api/ai-roundtable/turns/:id/audio', async (request, reply) => {
    const id = z.string().uuid().parse((request.params as { id?: unknown }).id);
    const turn = (await listAiRoundtableTurns(200)).find((entry) => entry.id === id);
    if (!turn?.audio_path) return reply.code(404).send({ error: 'Audio ist nicht verfügbar.' });
    return reply.header('Cache-Control', 'no-store').type('audio/wav').send(await readStoredFile(turn.audio_path));
  });
}
