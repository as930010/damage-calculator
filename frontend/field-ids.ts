import { FIELD_ID_TO_CODE } from "./field-transfer-codes.ts";

// Runtime fields use readable semantic IDs. Numeric codes are reserved for compact transfer files.
export { FIELD_ID_TO_CODE };
export const CODE_TO_FIELD_ID: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(FIELD_ID_TO_CODE).map(([fieldId, code]) => [String(code), fieldId])),
);

export function isFieldId(value: string): boolean {
  return Object.hasOwn(FIELD_ID_TO_CODE, value);
}

export function codeForFieldId(fieldId: string): number | undefined {
  return FIELD_ID_TO_CODE[fieldId];
}

export function fieldIdForCode(code: string): string | undefined {
  return CODE_TO_FIELD_ID[code];
}
