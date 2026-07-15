const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isResourceId(value: string | undefined): value is string {
  return Boolean(value && UUID_PATTERN.test(value));
}
