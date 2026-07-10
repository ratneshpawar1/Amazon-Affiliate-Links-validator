// Minimal in-memory chrome.storage.local for storage-backed unit tests.

export function installChromeStorageMock(): Map<string, unknown> {
  const store = new Map<string, unknown>();

  const local = {
    async get(query?: string | string[] | null): Promise<Record<string, unknown>> {
      if (query == null) return Object.fromEntries(store);
      const keys = Array.isArray(query) ? query : [query];
      const out: Record<string, unknown> = {};
      for (const k of keys) if (store.has(k)) out[k] = store.get(k);
      return out;
    },
    async set(obj: Record<string, unknown>): Promise<void> {
      for (const [k, v] of Object.entries(obj)) store.set(k, v);
    },
    async remove(keys: string | string[]): Promise<void> {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
    async clear(): Promise<void> {
      store.clear();
    },
  };

  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local },
  };
  return store;
}
