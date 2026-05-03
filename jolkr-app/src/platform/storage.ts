import { isTauri } from './detect';
import { STORAGE_KEYS } from '../utils/storageKeys';
import type { Stronghold } from '@tauri-apps/plugin-stronghold';

type StrongholdStore = Awaited<ReturnType<Awaited<ReturnType<Stronghold['loadClient']>>['getStore']>>;

export interface SecureStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Simple localStorage wrapper. E2EE keys are no longer stored here —
 *  only the seed lives in localStorage and keys are derived in memory. */
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
  private store: StrongholdStore | null = null;
  private stronghold: Stronghold | null = null;
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

  /**
   * Get or generate a per-installation vault password.
   * Stored in sessionStorage to reduce exposure — it only persists for the
   * browser session. On Tauri desktop, the vault is unlocked once per app
   * launch. A new random password is generated per install.
   */
  private getVaultPassword(): string {
    const VAULT_KEY = STORAGE_KEYS.VAULT_PASSWORD;
    // Check sessionStorage first (session-scoped), then localStorage (migration)
    let pw = sessionStorage.getItem(VAULT_KEY);
    if (!pw) {
      // Migrate from localStorage if present (from older versions)
      pw = localStorage.getItem(VAULT_KEY);
      if (pw) {
        sessionStorage.setItem(VAULT_KEY, pw);
        localStorage.removeItem(VAULT_KEY);
      }
    }
    if (!pw) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      pw = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      sessionStorage.setItem(VAULT_KEY, pw);
    }
    return pw;
  }

  private async _init(): Promise<void> {
    const { Stronghold } = await import('@tauri-apps/plugin-stronghold');
    const { appDataDir } = await import('@tauri-apps/api/path');

    const dataDir = await appDataDir();
    const vaultPath = `${dataDir}vault.hold`;
    const vaultPassword = this.getVaultPassword();

    try {
      // Try with per-installation password (new installs or already migrated)
      this.stronghold = await Stronghold.load(vaultPath, vaultPassword);
    } catch {
      // Existing vault from a previous version: open with the legacy password.
      // We do NOT auto-rotate the vault password here — Stronghold's password
      // change semantics need a verified path that survives interrupted
      // writes; getting that wrong would lock users out of their tokens.
      // Sunset plan (out of this audit's autonomous scope): require user to
      // sign out + sign in once, which deletes the vault file and creates a
      // fresh one under the per-install password.
      // (Console wording redacted — the previous text hinted at the legacy
      // passphrase to anyone with devtools open.)
      console.info('[TauriStorage] vault opened in compatibility mode');
      this.stronghold = await Stronghold.load(vaultPath, 'io.jolkr.app');
    }

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

// Desktop: Stronghold (encrypted). Android/iOS/Web: localStorage (Stronghold hangs on Android).
// Detect mobile via user agent since __TAURI_ENV_PLATFORM__ may not be available at import time.
function isDesktopTauri(): boolean {
  if (!isTauri) return false;
  const ua = navigator.userAgent.toLowerCase();
  return !ua.includes('android') && !ua.includes('iphone') && !ua.includes('ipad');
}

export const storage: SecureStorage = isDesktopTauri() ? new TauriStorage() : new WebStorage();
