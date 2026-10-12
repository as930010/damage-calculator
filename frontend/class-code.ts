export function sanitizeClassCode(value: string): string {
  return value.replace(/[^A-Za-z]/g, '');
}

export function resolveClassCode(value: string, classCodes: readonly string[]): string | null {
  if (!value || sanitizeClassCode(value) !== value) return null;
  return classCodes.find(code => code.toLocaleLowerCase() === value.toLocaleLowerCase()) ?? null;
}

/** The same UI code policy, prepared once for a fixed candidate list. */
export function createClassCodeResolver(classCodes: readonly string[]) {
  const codes = new Map<string, string>();
  for (const code of classCodes) if (!codes.has(code.toLocaleLowerCase())) codes.set(code.toLocaleLowerCase(), code);
  return (value: string): string | null => !value || sanitizeClassCode(value) !== value
    ? null : codes.get(value.toLocaleLowerCase()) ?? null;
}
