type JsonRecord = Record<string, unknown>;

function recordValue(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function comparable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(comparable);
  const record = recordValue(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, comparable(entry)]),
  );
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

export function hostBriefingWithFormatRegie(briefing: unknown, formatRegie: unknown): JsonRecord {
  return {
    ...(recordValue(briefing) ?? {}),
    formatRegie: recordValue(formatRegie) ?? {},
  };
}

export function hostFormatRegie(briefing: unknown, itemFormatRegie?: unknown): JsonRecord {
  return (
    recordValue(recordValue(briefing)?.formatRegie) ??
    recordValue(itemFormatRegie) ??
    {}
  );
}

export function hostBriefingNeedsRefresh(input: {
  storedBriefing: unknown;
  storedModel?: string | null;
  effectiveBriefing: unknown;
  desiredModel?: string | null;
  itemFormatRegie?: unknown;
}) {
  const effective = recordValue(input.effectiveBriefing);
  if (!effective) return false;

  const stored = recordValue(input.storedBriefing);
  if (!stored) return true;

  const expectedFormatRegie = recordValue(input.itemFormatRegie) ?? {};
  if (!sameJson(recordValue(stored.formatRegie) ?? {}, expectedFormatRegie)) return true;

  const storedModel = String(input.storedModel ?? '');
  if (!storedModel || storedModel === 'redaktioneller-fallback') return true;

  // A live research briefing contains additional verified material. Do not
  // replace it on every polling cycle with the less complete cached context.
  if (storedModel.includes('live-recherche')) return false;
  if (input.desiredModel && storedModel === input.desiredModel) return false;

  const storedContext = { ...stored };
  delete storedContext.formatRegie;
  return !sameJson(storedContext, effective);
}
