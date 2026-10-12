type TransferModule = typeof import('./loadout-transfer.ts');

/** One module request at a time; failed requests can be retried by the next action. */
export function createTransferLoader(load: () => Promise<TransferModule> = () => import('./loadout-transfer.ts')): () => Promise<TransferModule> {
  let pending: Promise<TransferModule> | undefined;
  return () => pending ??= Promise.resolve().then(load).catch(error => {
    pending = undefined;
    throw error;
  });
}
