import { invoke } from '@tauri-apps/api/core';
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

    // SEC-011 vault rotation (2026-05-04): legacy installs opened the
    // snapshot under a hardcoded constant `'io.jolkr.app'` password.
    // The first init after the migration release deletes that snapshot
    // and opens a fresh one under the per-install random password.
    // Idempotent via the V2 marker; runs once per install.
    //
    // No data preservation: the companion backend release truncates the
    // sessions table and bumps `JWT_MIN_ISSUED_AT`, so any tokens that
    // would have been in the legacy vault are server-side invalid
    // anyway. Frontend just needs a clean slate, which the login flow
    // then populates.
    const migrated = localStorage.getItem(STORAGE_KEYS.VAULT_MIGRATION_V2) === '1';
    if (!migrated) {
      try {
        await invoke('delete_vault_file', { path: vaultPath });
      } catch (e) {
        // Tolerate failure: a stale vault file blocks the new password
        // from opening cleanly, so we surface this so support can spot
        // it. Init then continues; if the file is genuinely there with
        // the legacy password, `Stronghold.load(...)` below will throw
        // and we fall back to WebStorage (existing behaviour).
        console.warn('[TauriStorage] vault delete failed during migration:', e);
      }
      localStorage.setItem(STORAGE_KEYS.VAULT_MIGRATION_V2, '1');
    }

    // Open under the per-install password. No legacy fallback: with the
    // V2 marker logic above, the snapshot is either fresh (just deleted)
    // or already on the new password from a previous successful boot.
    this.stronghold = await Stronghold.load(vaultPath, vaultPassword);

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
