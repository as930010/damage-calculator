type TransferModule = typeof import('./loadout-transfer.ts');

async function loadTransfer(attempt: number): Promise<TransferModule> {
  const path = typeof document === 'undefined' ? undefined
    : document.querySelector<HTMLMetaElement>('meta[name="loadout-transfer-url"]')?.content;
  if (attempt === 0 || !path) return import('./loadout-transfer.ts');
  // A browser can retain a failed module URL even after the server recovers.
  // The build supplies the same content-hashed chunk; only a failed retry changes its query.
  const url = new URL(path, document.baseURI);
  url.searchParams.set('retry', String(attempt));
  return import(url.href) as Promise<TransferModule>;
}

/** Share one request and its successful module. Bound user-triggered retries to three. */
export function createTransferLoader(load?: () => Promise<TransferModule>): () => Promise<TransferModule> {
  let pending: Promise<TransferModule> | undefined;
  let failures = 0;
  return () => {
    if (pending) return pending;
    if (failures >= 4) return Promise.reject(new Error('配裝功能仍無法載入，請重新整理頁面後重試。'));
    return pending = Promise.resolve().then(() => load ? load() : loadTransfer(failures)).catch(error => {
      failures++;
      pending = undefined;
      if (load) throw error;
      throw new Error('配裝功能載入失敗，請重試；若網站已更新，請重新整理頁面。', { cause: error });
    });
  };
}
