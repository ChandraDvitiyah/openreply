/** Normalize a JSON-backed SQLite value into the string-array shape used by campaigns. */
export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
