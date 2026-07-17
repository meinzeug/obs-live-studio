export function boundedMediaNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  options: { integer?: boolean } = {},
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const bounded = Math.max(minimum, Math.min(maximum, parsed));
  return options.integer === false ? bounded : Math.round(bounded);
}
