export type ConfigurationProgress = 'empty' | 'partial' | 'complete';
/** A shared reducer for data-derived equipment and beast requirements. */
export function configurationProgress(complete: readonly boolean[], hasSelection: boolean): ConfigurationProgress {
  return complete.length > 0 && complete.every(Boolean) ? 'complete' : hasSelection ? 'partial' : 'empty';
}
