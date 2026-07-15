export interface StoredSourceUpdateState {
  url: string;
  user_agent?: unknown;
}

export interface PreparedSourceUpdate {
  next: Record<string, unknown>;
  url: URL;
  urlChanged: boolean;
  userAgent: string | null;
}

const sourceUpdateFields = new Set([
  'name',
  'url',
  'type',
  'category',
  'region',
  'language',
  'description',
  'priority',
  'trustLevel',
  'fetchIntervalSeconds',
  'maxArticles',
  'maxFetchSeconds',
  'active',
  'userAgent',
]);
const invalidUserAgentCharacters = /[\u0000-\u001f\u007f]/;

export class SourceUpdateInputError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'SourceUpdateInputError';
  }
}

function normalizedUserAgent(value: unknown, rejectInvalid = false) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    if (rejectInvalid) throw new SourceUpdateInputError('Der User-Agent muss eine Zeichenkette sein');
    return null;
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (invalidUserAgentCharacters.test(normalized)) {
    if (rejectInvalid) throw new SourceUpdateInputError('Der User-Agent enthält ungültige Steuerzeichen');
    return null;
  }
  return normalized;
}

function validateUpdateFields(input: Record<string, unknown>) {
  const fields = Object.keys(input);
  if (!fields.length) throw new SourceUpdateInputError('Keine Änderungen angegeben');
  const unknownFields = fields.filter((field) => !sourceUpdateFields.has(field));
  if (unknownFields.length) {
    throw new SourceUpdateInputError(`Unbekannte Felder: ${unknownFields.join(', ')}`);
  }
}

function parseUpdatedUrl(current: StoredSourceUpdateState, input: Record<string, unknown>) {
  try {
    return {
      currentUrl: new URL(String(current.url)),
      url: new URL(String({ ...(current as Record<string, unknown>), ...input }.url)),
    };
  } catch (error) {
    if (Object.hasOwn(input, 'url')) throw new SourceUpdateInputError('Die Quellen-URL ist ungültig');
    throw error;
  }
}

export function prepareSourceUpdate(
  current: StoredSourceUpdateState,
  input: Record<string, unknown>,
): PreparedSourceUpdate {
  validateUpdateFields(input);
  const next: Record<string, unknown> = { ...(current as Record<string, unknown>), ...input };
  const { currentUrl, url } = parseUpdatedUrl(current, input);
  const userAgent = Object.hasOwn(input, 'userAgent')
    ? normalizedUserAgent(input.userAgent, true)
    : normalizedUserAgent(current.user_agent);

  return {
    next,
    url,
    urlChanged: currentUrl.toString() !== url.toString(),
    userAgent,
  };
}
