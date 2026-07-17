export function boundedRunnerNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(Math.max(minimum, Math.min(maximum, parsed)));
}
