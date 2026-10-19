const STORAGE_KEY = 'damage-calculator.disclosures.v1';

/** Persist disclosure choices separately from the saved loadout. */
export function createDisclosurePreferences(root: Document) {
  const saved: Record<string, boolean> = {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'boolean') saved[key] = value;
      }
    }
  } catch { /* Storage may be unavailable or contain invalid data. */ }

  root.addEventListener('toggle', event => {
    const detail = event.target;
    if (!(detail instanceof HTMLDetailsElement) || !detail.isConnected) return;
    const key = detail.dataset.disclosureKey;
    if (!key || saved[key] === detail.open) return;
    saved[key] = detail.open;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); }
    catch { /* Disclosure controls still work without persistent storage. */ }
  }, true);

  window.addEventListener('pagehide', () => {
    for (const detail of root.querySelectorAll<HTMLDetailsElement>('details[data-disclosure-key]')) {
      saved[detail.dataset.disclosureKey!] = detail.open;
    }
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); }
    catch { /* Closing the page must not affect the loadout or navigation. */ }
  });

  const preferredOpen = (key: string, fallback: boolean) => saved[key] ?? fallback;
  const restore = (scope: ParentNode) => {
    const details = scope instanceof HTMLDetailsElement
      ? [scope, ...scope.querySelectorAll<HTMLDetailsElement>('details[data-disclosure-key]')]
      : [...scope.querySelectorAll<HTMLDetailsElement>('details[data-disclosure-key]')];
    for (const detail of details) {
      const key = detail.dataset.disclosureKey!;
      if (Object.hasOwn(saved, key)) detail.open = saved[key];
    }
  };
  return { preferredOpen, restore };
}
