import { readFile, writeFile } from 'node:fs/promises';

async function replaceOnce(path, search, replacement) {
  const current = await readFile(path, 'utf8');
  if (current.includes(replacement)) return false;
  if (!current.includes(search)) throw new Error(`Expected marker not found in ${path}: ${search.slice(0, 100)}`);
  await writeFile(path, current.replace(search, replacement));
  return true;
}

const provider = 'packages/ai-provider/src/index.ts';
let source = await readFile(provider, 'utf8');

source = source.replace(
  "  appName: string;\n};",
  "  appName: string;\n  localFallback: boolean;\n  ollamaBaseUrl: string;\n  ollamaModel: string;\n  ollamaTimeoutMs: number;\n};",
);
source = source.replace(
  "    appName: env.OPENROUTER_APP_NAME?.trim() || 'OBS Live Studio',\n  };",
  "    appName: env.OPENROUTER_APP_NAME?.trim() || 'OBS Live Studio',\n    localFallback: booleanSetting(env.AI_LOCAL_FALLBACK, true),\n    ollamaBaseUrl: (env.OLLAMA_BASE_URL?.trim() || 'http://127.0.0.1:11434').replace(/\\/$/, ''),\n    ollamaModel: env.OLLAMA_MODEL?.trim() || 'qwen2.5:7b',\n    ollamaTimeoutMs: boundedNumber(env.OLLAMA_TIMEOUT_MS, 300_000, 10_000, 1_800_000),\n  };",
);
source = source.replace("  tier: 'free' | 'paid';", "  tier: 'free' | 'paid' | 'local';");

const marker = "async function runStructuredTask<T extends AiTaskId>(\n";
if (!source.includes('async function runLocalStructuredTask')) {
  const helper = `async function runLocalStructuredTask<T extends AiTaskId>(\n  task: T,\n  userPrompt: string,\n  config: OpenRouterConfig,\n  fetchImpl: FetchImplementation,\n): Promise<AiTaskResult<z.infer<(typeof OUTPUT_SCHEMAS)[T]>>> {\n  if (!config.localFallback) {\n    throw Object.assign(new Error('Lokaler KI-Fallback ist deaktiviert.'), {\n      statusCode: 503,\n      code: 'AI_LOCAL_FALLBACK_DISABLED',\n    });\n  }\n  const controller = new AbortController();\n  const timeout = setTimeout(() => controller.abort(), config.ollamaTimeoutMs);\n  try {\n    const response = await fetchImpl(\`${'${config.ollamaBaseUrl}'}/api/chat\`, {\n      method: 'POST',\n      signal: controller.signal,\n      headers: { 'Content-Type': 'application/json' },\n      body: JSON.stringify({\n        model: config.ollamaModel,\n        stream: false,\n        messages: taskMessages(task, userPrompt, false),\n        format: openRouterCompatibleJsonSchema(JSON_SCHEMAS[task]),\n        options: { temperature: task === 'host-response' || task === 'overlay' ? 0.4 : 0.2 },\n      }),\n    });\n    const payload = (await response.json().catch(() => null)) as any;\n    if (!response.ok) {\n      throw Object.assign(\n        new Error(\`Ollama-Fallback nicht verfügbar (\${response.status}): \${safeApiError(payload, response.status)}\`),\n        { statusCode: 503, code: 'OLLAMA_UNAVAILABLE' },\n      );\n    }\n    const content = payload?.message?.content;\n    if (typeof content !== 'string' || !content.trim()) {\n      throw Object.assign(new Error('Ollama hat keine verwertbare Antwort geliefert.'), {\n        statusCode: 502,\n        code: 'OLLAMA_EMPTY_RESPONSE',\n      });\n    }\n    let parsed: unknown;\n    try {\n      parsed = JSON.parse(content);\n    } catch {\n      throw new InvalidAiResponseError(content, config.ollamaModel);\n    }\n    const output = OUTPUT_SCHEMAS[task].parse(parsed) as z.infer<(typeof OUTPUT_SCHEMAS)[T]>;\n    return {\n      output,\n      model: \`ollama/\${config.ollamaModel}\`,\n      tier: 'local',\n      usage: {\n        promptTokens: Number.isFinite(payload?.prompt_eval_count) ? payload.prompt_eval_count : null,\n        completionTokens: Number.isFinite(payload?.eval_count) ? payload.eval_count : null,\n        totalTokens:\n          Number.isFinite(payload?.prompt_eval_count) && Number.isFinite(payload?.eval_count)\n            ? payload.prompt_eval_count + payload.eval_count\n            : null,\n        cost: 0,\n      },\n    };\n  } catch (error) {\n    if ((error as Error).name === 'AbortError') {\n      throw Object.assign(new Error('Das lokale Ollama-Modell hat nicht rechtzeitig geantwortet.'), {\n        statusCode: 504,\n        code: 'OLLAMA_TIMEOUT',\n      });\n    }\n    if (error instanceof TypeError) {\n      throw Object.assign(new Error('Ollama konnte lokal nicht erreicht werden.'), {\n        statusCode: 503,\n        code: 'OLLAMA_UNAVAILABLE',\n      });\n    }\n    throw error;\n  } finally {\n    clearTimeout(timeout);\n  }\n}\n\n`;
  source = source.replace(marker, helper + marker);
}

source = source.replace(
  "  if (!config.apiKey) {\n    throw Object.assign(new Error('OpenRouter ist nicht konfiguriert. API-Key unter Einstellungen → KI hinterlegen.'), {\n      statusCode: 409,\n    });\n  }\n  const policy = AI_TASK_POLICIES[task];\n  const fetchImpl = options.fetchImpl ?? fetch;",
  "  const fetchImpl = options.fetchImpl ?? fetch;\n  if (!config.apiKey) return runLocalStructuredTask(task, userPrompt, config, fetchImpl);\n  const policy = AI_TASK_POLICIES[task];",
);
source = source.replace(
  "  if (!paidAllowed || !policy.paidModels.length) throw lastInvalidResponse ?? lastError ?? new InvalidAiResponseError();\n  if (!openRouterBudgetAdapter) throw lastInvalidResponse ?? lastError ?? new InvalidAiResponseError();",
  "  if (!paidAllowed || !policy.paidModels.length)\n    return runLocalStructuredTask(task, userPrompt, config, fetchImpl).catch(() => {\n      throw lastInvalidResponse ?? lastError ?? new InvalidAiResponseError();\n    });\n  if (!openRouterBudgetAdapter)\n    return runLocalStructuredTask(task, userPrompt, config, fetchImpl).catch(() => {\n      throw lastInvalidResponse ?? lastError ?? new InvalidAiResponseError();\n    });",
);
source = source.replace(
  "      throw Object.assign(new Error(reason), { statusCode: 429, code: 'OPENROUTER_BUDGET_EXHAUSTED' });",
  "      return runLocalStructuredTask(task, userPrompt, config, fetchImpl).catch(() => {\n        throw Object.assign(new Error(reason), { statusCode: 429, code: 'OPENROUTER_BUDGET_EXHAUSTED' });\n      });",
);
source = source.replace(
  "  throw lastInvalidResponse ?? lastError ?? new InvalidAiResponseError();\n}\n\nfunction limitedText",
  "  return runLocalStructuredTask(task, userPrompt, config, fetchImpl).catch(() => {\n    throw lastInvalidResponse ?? lastError ?? new InvalidAiResponseError();\n  });\n}\n\nfunction limitedText",
);

await writeFile(provider, source);

const envPath = '.env.example';
let env = await readFile(envPath, 'utf8');
if (!env.includes('AI_LOCAL_FALLBACK=')) {
  env += `\n# Lokale KI-Kontinuität: übernimmt automatisch bei fehlendem API-Key, Free-Limit, Budgetstopp oder OpenRouter-Ausfall.\nAI_LOCAL_FALLBACK=true\nOLLAMA_BASE_URL=http://127.0.0.1:11434\nOLLAMA_MODEL=qwen2.5:7b\n# Langsame CPU-Modelle dürfen bewusst mehrere Minuten rechnen.\nOLLAMA_TIMEOUT_MS=300000\n`;
  await writeFile(envPath, env);
}

const readmePath = 'README.md';
let readme = await readFile(readmePath, 'utf8');
if (!readme.includes('### KI-Kontinuitätsmodus')) {
  const section = `\n### KI-Kontinuitätsmodus\n\nOpenRouter ist kein Single Point of Failure. Sobald kein API-Key vorhanden ist, kostenlose Limits erschöpft sind, das konfigurierte Tagesbudget stoppt oder OpenRouter nicht erreichbar ist, wechselt der strukturierte KI-Provider automatisch auf ein lokales Ollama-Modell. Der Standard ist \`qwen2.5:7b\`; auf CPU-Systemen darf die Antwort bewusst mehrere Minuten dauern. Live-Moderation und redaktionelle Kernaufgaben bleiben dadurch verfügbar, ohne kostenpflichtiges Guthaben vorauszusetzen. Der lokale Pfad verwendet dieselben strikten JSON-Schemata wie der Cloud-Pfad und meldet Modell, Token und den kostenfreien Tier \`local\` transparent zurück.\n\n\`AI_LOCAL_FALLBACK=false\` deaktiviert den lokalen Pfad ausdrücklich. \`OLLAMA_BASE_URL\`, \`OLLAMA_MODEL\` und \`OLLAMA_TIMEOUT_MS\` steuern Laufzeit und Modell. Für einen belastbaren Dauerbetrieb sollte das Modell vor Sendungsbeginn mit \`ollama pull qwen2.5:7b\` lokal vorhanden sein.\n`;
  readme = readme.replace('\n### Sprachausgabe\n', `${section}\n### Sprachausgabe\n`);
  await writeFile(readmePath, readme);
}

console.log('AI continuity changes applied.');
