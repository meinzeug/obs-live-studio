export function aiHostOverlayDurationSeconds(value: number) {
  if (!Number.isFinite(value)) return 24;
  return Math.max(8, Math.min(120, Math.floor(value)));
}
