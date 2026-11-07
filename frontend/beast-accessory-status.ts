import { configurationProgress, type ConfigurationProgress } from './configuration-progress.ts';
import type { CatalogIndex } from './catalog-index.ts';
import { resolveMasterBeastEffects } from '../calculation/equipment-effects.ts';

export interface BeastAccessoryFields {
  fixedFields?: readonly string[];
  stoneFields?: readonly [string, string];
  mirrorFields: readonly (readonly [string, string])[];
}
/** Derived from saved fields only; never infers historical user intent. */
export function beastAccessoryStatus(slot: BeastAccessoryFields, values: Readonly<Record<string, string | number>>, index: CatalogIndex): ConfigurationProgress {
  let selected = 0;
  const validChoice = (field: string) => {
    const value = values[field];
    return value !== undefined && value !== '' && Boolean(index.resolveFieldChoices(field, values)?.some(choice => String(choice) === String(value)));
  };
  const fixed = (slot.fixedFields ?? []).map(field => {
    const valid = validChoice(field); if (valid) selected++; return valid;
  });
  const pair = ([attribute, field]: readonly [string, string], mirror: boolean) => {
    if (!validChoice(attribute)) return false;
    selected++;
    if (values[attribute] === '無關傷害') return true;
    const raw = values[field];
    if (raw === undefined || String(raw).trim() === '' || !Number.isFinite(Number(raw))) return false;
    if (!mirror) return Boolean(index.resolveFieldChoices(field, values)?.some(choice => Number(choice) === Number(raw)));
    try {
      resolveMasterBeastEffects(index.data.masterBeast, { mirrorManual: [{ attribute: String(values[attribute]), value: Number(raw), fractionToPercentagePoints: true }] });
      return true;
    } catch { return false; }
  };
  const completed = [...fixed, ...(slot.stoneFields ? [pair(slot.stoneFields, false)] : []), ...slot.mirrorFields.map(fields => pair(fields, true))];
  return configurationProgress(completed, selected > 0);
}
