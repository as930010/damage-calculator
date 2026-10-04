export function sanitizeClassCode(value: string): string {
  return value.replace(/[^A-Za-z]/g, '');
}

export function resolveClassCode(value: string, classCodes: readonly string[]): string | null {
  if (!value || sanitizeClassCode(value) !== value) return null;
  return classCodes.find(code => code.toLocaleLowerCase() === value.toLocaleLowerCase()) ?? null;
}
