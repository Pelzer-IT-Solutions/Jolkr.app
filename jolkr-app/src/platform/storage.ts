import { isTauri } from './detect';

export interface SecureStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

class WebStorage implements SecureStorage {
  async get(key: string): Promise<string | null> {
    return localStorage.getItem(key);
  }
  async set(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  }
  async remove(key: string): Promise<void> {
    localStorage.removeItem(key);
  }
}

class TauriStorage implements SecureStorage {
  private initPromise: Promise<void> | null = null;
  private store: Awaited<ReturnType<Awaited<ReturnType<import('@tauri-apps/plugin-stronghold').Stronghold['loadClient']>>['getStore']>> | null = null;
  private stronghold: import('@tauri-apps/plugin-stronghold').Stronghold | null = null;
  private fallbackToWeb = false;

  private async ensureInitialized(): Promise<void> {
    if (this.fallbackToWeb || this.store) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._init().catch((e) => {
      console.warn('[TauriStorage] Stronghold failed, falling back to localStorage:', e);
      this.fallbackToWeb = true;
      this.initPromise = null;
    });
    return this.initPromise;
  }

  private async _init(): Promise<void> {
    const { Stronghold } = await import('@tauri-apps/plugin-stronghold');
    const { appDataDir } = await import('@tauri-apps/api/path');

    const dataDir = await appDataDir();
    const vaultPath = `${dataDir}vault.hold`;

    this.stronghold = await Stronghold.load(vaultPath, 'io.jolkr.app');

    let client;
    try {
      client = await this.stronghold.loadClient('jolkr');
    } catch {
      client = await this.stronghold.createClient('jolkr');
    }

    this.store = client.getStore();
    await this.migrateFromLocalStorage();
  }

  private async migrateFromLocalStorage(): Promise<void> {
    const keysToMigrate = ['access_token', 'refresh_token'];
    let migrated = false;

    for (const key of keysToMigrate) {
      const value = localStorage.getItem(key);
      if (value !== null) {
        const data = Array.from(new TextEncoder().encode(value));
        await this.store!.insert(key, data);
        localStorage.removeItem(key);
        migrated = true;
      }
    }

    if (migrated) {
      await this.stronghold!.save();
    }
  }

  async get(key: string): Promise<string | null> {
    await this.ensureInitialized();
    if (this.fallbackToWeb) return localStorage.getItem(key);
    const data = await this.store!.get(key);
    if (!data) return null;
    return new TextDecoder().decode(new Uint8Array(data));
  }

  async set(key: string, value: string): Promise<void> {
    await this.ensureInitialized();
    if (this.fallbackToWeb) { localStorage.setItem(key, value); return; }
    const data = Array.from(new TextEncoder().encode(value));
    await this.store!.insert(key, data);
    await this.stronghold!.save();
  }

  async remove(key: string): Promise<void> {
    await this.ensureInitialized();
    if (this.fallbackToWeb) { localStorage.removeItem(key); return; }
    await this.store!.remove(key);
    await this.stronghold!.save();
  }
}

export const storage: SecureStorage = isTauri ? new TauriStorage() : new WebStorage();
