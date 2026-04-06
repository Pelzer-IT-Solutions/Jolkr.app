import { isTauri } from './detect';

export interface SecureStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Keys that contain sensitive cryptographic material and must be encrypted at rest. */
const SENSITIVE_KEYS = new Set([
  'e2ee_identity_pub', 'e2ee_identity_priv',
  'e2ee_signed_prekey_pub', 'e2ee_signed_prekey_priv', 'e2ee_signed_prekey_sig',
  'e2ee_pq_encapsulation_key', 'e2ee_pq_decapsulation_key', 'e2ee_pq_signature',
]);

const STORAGE_KEY_SESSION = 'jolkr_storage_enc_key';
const ENCRYPTED_PREFIX = 'enc:';

class WebStorage implements SecureStorage {
  private encKey: CryptoKey | null = null;

  /** Import the storage encryption key from sessionStorage, if available. */
  private async getEncKey(): Promise<CryptoKey | null> {
    if (this.encKey) return this.encKey;
    const raw = sessionStorage.getItem(STORAGE_KEY_SESSION);
    if (!raw) return null;
    const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
    this.encKey = await crypto.subtle.importKey(
      'raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'],
    );
    return this.encKey;
  }

  private async encryptValue(value: string): Promise<string> {
    const key = await this.getEncKey();
    if (!key) return value; // No encryption key yet — store plaintext
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(value),
    ));
    // Pack as base64(nonce || ciphertext)
    const packed = new Uint8Array(12 + ct.length);
    packed.set(nonce);
    packed.set(ct, 12);
    let b64 = '';
    for (let i = 0; i < packed.length; i++) b64 += String.fromCharCode(packed[i]);
    return ENCRYPTED_PREFIX + btoa(b64);
  }

  private async decryptValue(stored: string): Promise<string> {
    if (!stored.startsWith(ENCRYPTED_PREFIX)) return stored; // Legacy plaintext
    const key = await this.getEncKey();
    if (!key) throw new Error('Storage encryption key not available — re-login required');
    const raw = atob(stored.slice(ENCRYPTED_PREFIX.length));
    const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
    const nonce = bytes.slice(0, 12);
    const ct = bytes.slice(12);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce }, key, ct,
    );
    return new TextDecoder().decode(pt);
  }

  async get(key: string): Promise<string | null> {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    if (SENSITIVE_KEYS.has(key) && raw.startsWith(ENCRYPTED_PREFIX)) {
      try { return await this.decryptValue(raw); }
      catch { return null; } // Key not available — user must re-login
    }
    return raw;
  }

  async set(key: string, value: string): Promise<void> {
    if (SENSITIVE_KEYS.has(key)) {
      localStorage.setItem(key, await this.encryptValue(value));
    } else {
      localStorage.setItem(key, value);
    }
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

  /** Get or generate a per-installation vault password (stored in localStorage). */
  private getVaultPassword(): string {
    const VAULT_KEY = 'jolkr_vault_key';
    let pw = localStorage.getItem(VAULT_KEY);
    if (!pw) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      pw = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(VAULT_KEY, pw);
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
      // Existing vault with legacy hardcoded password — use it for compatibility
      console.warn('[TauriStorage] Using legacy vault password — will migrate on next fresh install');
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
