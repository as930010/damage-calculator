export function sanitizeUnsignedInteger(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

export function resolveUnsignedInteger(value: string): string | null {
  return /^[0-9]+$/.test(value) ? value : null;
}
