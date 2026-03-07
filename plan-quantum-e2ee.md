# Plan: Full Quantum-Proof E2EE — STAY PRIVATE

## Doel
Maak ALLE communicatie end-to-end encrypted en quantum-proof, zoals beloofd op de landing page:
- DM berichten (al E2EE, upgraden naar post-quantum)
- Channel/server berichten (nu plaintext, toevoegen E2EE)
- Voice/video calls (nu onversleuteld, toevoegen E2EE)

## Huidige staat

| Feature | Status | Crypto |
|---------|--------|--------|
| DM berichten | E2EE | X25519 + AES-256-GCM (kwetsbaar voor quantum) |
| Channel berichten | Plaintext | Geen E2EE |
| Group DMs | Plaintext | Geen E2EE |
| Voice/Video | Onversleuteld | SFU ziet alle media |
| Key exchange | X3DH | Ed25519 + X25519 (kwetsbaar voor quantum) |

## Architectuur overzicht

### Crypto stack (nieuw)
```
Key Exchange:  X25519 + ML-KEM-768 (hybrid, quantum-safe)
Signatures:    Ed25519 + ML-DSA-65 (hybrid, quantum-safe)
Symmetric:     AES-256-GCM (al quantum-safe — Grover halveert naar 128-bit)
Group keys:    Sender Keys protocol (per-channel sender key)
Voice E2EE:    SFrame + RTCRtpScriptTransform
```

### Libraries
```
Client (JS/TS):
  @noble/post-quantum  — ML-KEM-768, ML-DSA-65 (FIPS 203/204)
  @noble/curves        — X25519, Ed25519 (bestaand)
  sframe               — WebRTC media frame encryption

Server (Rust):
  Bestaand crypto ongewijzigd — server hoeft NIET te decrypten
  Alleen key storage uitbreiden voor grotere PQ keys
```

---

## Fase 1: Post-Quantum Hybrid DM E2EE

**Doel:** Upgrade bestaande DM E2EE van klassiek naar quantum-proof hybrid.

### 1.1 Client: Hybrid key generation

**Bestand:** `jolkr-app/src/crypto/keys.ts`

Huidige flow:
- `generateIdentityKeyPair()` → Ed25519 keypair
- `generateSignedPreKey()` → X25519 keypair + Ed25519 signature
- `x25519KeyAgreement()` → shared secret

Nieuwe flow:
- `generateIdentityKeyPair()` → Ed25519 + ML-DSA-65 keypairs
- `generateSignedPreKey()` → X25519 + ML-KEM-768 keypairs + hybrid signature
- `hybridKeyAgreement()` → X25519 shared secret || ML-KEM decapsulated secret → HKDF

```typescript
// Hybrid key agreement: combine classical + post-quantum
export async function hybridKeyAgreement(
  x25519Private: Uint8Array,
  x25519Public: Uint8Array,
  mlkemCiphertext: Uint8Array,
  mlkemPrivate: Uint8Array,
): Promise<Uint8Array> {
  const classicalSecret = x25519.getSharedSecret(x25519Private, x25519Public);
  const { sharedSecret: pqSecret } = ml_kem768.decapsulate(mlkemCiphertext, mlkemPrivate);
  // Combine: HKDF(classical || pq || context)
  return hkdfCombine(classicalSecret, pqSecret);
}
```

### 1.2 Client: Updated prekey bundle format

**Bestand:** `jolkr-app/src/crypto/keys.ts`

```typescript
export interface HybridPreKeyBundle {
  userId: string;
  deviceId: string;
  // Classical
  identityKey: Uint8Array;        // Ed25519 public
  signedPrekey: Uint8Array;       // X25519 public
  signedPrekeySignature: Uint8Array; // Ed25519 sig
  // Post-quantum
  pqIdentityKey: Uint8Array;      // ML-DSA-65 public
  pqSignedPrekey: Uint8Array;     // ML-KEM-768 public (encapsulation key)
  pqSignedPrekeySignature: Uint8Array; // ML-DSA-65 sig
  // Optional
  oneTimePrekey?: Uint8Array;     // X25519 OTP
}
```

### 1.3 Server: Database migration

**Bestand:** `jolkr-server/migrations/021_pq_keys.sql`

```sql
ALTER TABLE user_keys
  ADD COLUMN pq_identity_key BYTEA,
  ADD COLUMN pq_signed_prekey BYTEA,
  ADD COLUMN pq_signed_prekey_signature BYTEA;
```

ML-DSA-65 public key: ~1952 bytes
ML-KEM-768 public key: ~1184 bytes
Totaal extra: ~3.5 KB per prekey bundle (acceptabel)

### 1.4 Server: API endpoints updaten

**Bestanden:**
- `jolkr-server/crates/jolkr-api/src/routes/keys.rs`
- `jolkr-server/crates/jolkr-core/src/services/key.rs`
- `jolkr-server/crates/jolkr-db/src/repo/keys.rs`

Upload endpoint accepteert nieuwe PQ velden (optioneel voor backwards compat).
Fetch endpoint retourneert PQ velden als beschikbaar.

### 1.5 Client: E2EE service updaten

**Bestanden:**
- `jolkr-app/src/services/e2ee.ts`
- `jolkr-app/src/crypto/e2ee.ts`
- `jolkr-app/src/crypto/keyStore.ts`

Bij het opzetten van een sessie:
1. Fetch recipient's prekey bundle (nu met PQ keys)
2. X25519 key agreement (klassiek)
3. ML-KEM encapsulate met recipient's PQ prekey (post-quantum)
4. Combineer beide secrets via HKDF
5. Derive AES-256-GCM key uit hybrid secret

### 1.6 Backwards compatibility

- Als recipient GEEN PQ keys heeft → fallback naar klassieke X25519-only
- Nieuwe clients uploaden altijd PQ keys
- Geleidelijke migratie: zodra beide partijen PQ keys hebben → hybrid

---

## Fase 2: Channel/Server E2EE (Sender Keys)

**Doel:** Encrypt alle channel berichten end-to-end met Sender Keys protocol.

### Hoe Sender Keys werkt
1. Elke user genereert een **sender key** per channel
2. Sender key wordt versleuteld naar elke channel member via pairwise E2EE (hybrid X25519+ML-KEM)
3. Berichten worden versleuteld met de sender key (AES-256-GCM)
4. Alle members decrypten met dezelfde sender key
5. Bij member join: stuur sender key naar nieuwe member
6. Bij member leave: **rekey** — alle bestaande members genereren nieuwe sender keys

### 2.1 Database: Sender key storage

**Bestand:** `jolkr-server/migrations/022_sender_keys.sql`

```sql
CREATE TABLE channel_sender_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Encrypted sender key blob (encrypted per-recipient)
  recipient_user_id UUID NOT NULL REFERENCES users(id),
  encrypted_key BYTEA NOT NULL,
  key_generation INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(channel_id, user_id, recipient_user_id, key_generation)
);

-- Channel messages: add encrypted fields (same as DM messages)
ALTER TABLE messages
  ADD COLUMN encrypted_content BYTEA,
  ADD COLUMN nonce BYTEA,
  ADD COLUMN sender_key_generation INT;
```

### 2.2 Client: Sender Key management

**Nieuw bestand:** `jolkr-app/src/crypto/senderKeys.ts`

```typescript
export async function generateSenderKey(): Promise<CryptoKey>;
export async function distributeSenderKey(channelId: string, members: string[]): Promise<void>;
export async function encryptWithSenderKey(channelId: string, plaintext: string): Promise<EncryptedMessage>;
export async function decryptWithSenderKey(channelId: string, senderId: string, ciphertext: Uint8Array, nonce: Uint8Array): Promise<string>;
export async function rekeyChannel(channelId: string): Promise<void>;
```

### 2.3 Server: Message endpoints

**Bestand:** `jolkr-server/crates/jolkr-api/src/routes/messages.rs`

- `POST /channels/:id/messages` accepteert `encrypted_content` + `nonce` + `sender_key_generation`
- Server slaat encrypted op, broadcast via NATS
- Server slaat GEEN plaintext meer op als encrypted_content aanwezig is

### 2.4 Server: Sender key distribution endpoints

**Nieuw:**
- `POST /channels/:id/sender-keys` — upload encrypted sender keys voor members
- `GET /channels/:id/sender-keys/:user_id` — haal sender key op voor een specifieke user
- `POST /channels/:id/rekey` — trigger rekey event (na member leave)

### 2.5 Client: Message flow update

**Bestand:** `jolkr-app/src/components/MessageInput.tsx`

```
Huidig (channel):
  content → plaintext → API → broadcast

Nieuw (channel):
  content → encrypt(senderKey) → { encrypted_content, nonce } → API → broadcast
  Recipients: decrypt(senderKey[senderId]) → plaintext
```

### 2.6 Rekeying bij member changes

- WebSocket event `MemberRemove` → trigger rekey
- Alle remaining members genereren nieuwe sender keys
- Distribute via pairwise E2EE
- `key_generation` counter incrementeert

---

## Fase 3: Voice/Video E2EE

**Doel:** Encrypt WebRTC media frames zodat de SFU alleen ciphertext forwardt.

### 3.1 Client: SFrame encryption

**Nieuw bestand:** `jolkr-app/src/voice/frameEncryption.ts`

```typescript
// SFrame-gebaseerde frame encryption
export class VoiceEncryptor {
  private key: CryptoKey;
  private frameCounter: number = 0;

  async encryptFrame(frame: RTCEncodedAudioFrame): Promise<RTCEncodedAudioFrame>;
  async decryptFrame(frame: RTCEncodedAudioFrame): Promise<RTCEncodedAudioFrame>;
}
```

### 3.2 Client: Insertable Streams integratie

**Bestand:** `jolkr-app/src/voice/voiceService.ts`

```typescript
// Na het aanmaken van RTCPeerConnection:
const sender = peerConnection.addTrack(audioTrack);
const senderTransform = new RTCRtpScriptTransform(worker, { side: 'send' });
sender.transform = senderTransform;

const receiver = peerConnection.getReceivers()[0];
const receiverTransform = new RTCRtpScriptTransform(worker, { side: 'receive' });
receiver.transform = receiverTransform;
```

### 3.3 Client: Encryption Worker

**Nieuw bestand:** `jolkr-app/src/voice/encryptionWorker.ts`

Web Worker die frame encryption/decryption doet in een aparte thread.
Keys worden via `postMessage` naar de worker gestuurd.

### 3.4 Key negotiation voor voice

Voice key = afgeleide van channel's sender key (of aparte voice session key).
Bij join voice channel:
1. Genereer ephemeral voice session key
2. Distribute via sender key encrypted channel
3. Alle voice participants gebruiken dezelfde symmetric key
4. Bij participant join/leave: rekey

### 3.5 SFU: Geen wijzigingen nodig

De SFU (str0m) forwardt RTP packets ongewijzigd. Encrypted frames zijn opaque data voor de SFU — het hoeft niet te decrypten. Geen server-side changes nodig.

---

## Fase 4: Group DM E2EE

**Doel:** E2EE voor groeps-DMs (multi-user DM channels).

Zelfde Sender Keys protocol als Fase 2, maar dan voor DM channels met >2 deelnemers.
De code is herbruikbaar — `channel_sender_keys` tabel werkt voor zowel server channels als group DMs.

---

## Fase 5: Hardening

### 5.1 Stop plaintext opslag
- Server slaat GEEN plaintext meer op als E2EE beschikbaar is
- Verwijder `content` kolom vulling als `encrypted_content` aanwezig is
- Migratie: oude plaintext berichten blijven, nieuwe berichten alleen encrypted

### 5.2 Key verification UI
- Toon key fingerprints in UserProfileCard
- "Verify" button voor out-of-band verificatie
- Safety numbers (zoals Signal)

### 5.3 Device management
- Meerdere devices per user
- Per-device prekey bundles
- Device list zichtbaar in settings

---

## Volgorde van uitvoering

| Fase | Scope | Prioriteit |
|------|-------|------------|
| 1 | PQ Hybrid DM E2EE | EERST — fundament voor alles |
| 2 | Channel Sender Keys | TWEEDE — meeste impact |
| 3 | Voice E2EE | DERDE — apart systeem |
| 4 | Group DM E2EE | VIERDE — hergebruik fase 2 |
| 5 | Hardening | VIJFDE — polish |

## Bestanden overzicht

### Client (wijzigen)
- `jolkr-app/src/crypto/keys.ts` — hybrid key generation
- `jolkr-app/src/crypto/e2ee.ts` — hybrid key agreement
- `jolkr-app/src/crypto/keyStore.ts` — PQ key opslag
- `jolkr-app/src/services/e2ee.ts` — high-level E2EE service
- `jolkr-app/src/components/MessageInput.tsx` — channel encryption
- `jolkr-app/src/hooks/useDecryptedContent.ts` — channel decryption
- `jolkr-app/src/voice/voiceService.ts` — SFrame integratie

### Client (nieuw)
- `jolkr-app/src/crypto/senderKeys.ts` — Sender Key protocol
- `jolkr-app/src/crypto/hybrid.ts` — PQ hybrid helpers
- `jolkr-app/src/voice/frameEncryption.ts` — SFrame worker
- `jolkr-app/src/voice/encryptionWorker.ts` — Web Worker

### Server (wijzigen)
- `jolkr-server/crates/jolkr-api/src/routes/keys.rs` — PQ key endpoints
- `jolkr-server/crates/jolkr-api/src/routes/messages.rs` — encrypted channel msgs
- `jolkr-server/crates/jolkr-core/src/services/key.rs` — PQ key service
- `jolkr-server/crates/jolkr-db/src/repo/keys.rs` — PQ key queries

### Server (nieuw)
- `jolkr-server/migrations/021_pq_keys.sql` — PQ key columns
- `jolkr-server/migrations/022_sender_keys.sql` — sender key tables
- `jolkr-server/crates/jolkr-api/src/routes/sender_keys.rs` — sender key endpoints
- `jolkr-server/crates/jolkr-core/src/services/sender_key.rs` — sender key service
- `jolkr-server/crates/jolkr-db/src/repo/sender_keys.rs` — sender key queries

## Verificatie

Per fase:
- `npx tsc --noEmit` — type check
- `npx vite build` — frontend build
- `cargo build` — backend build
- End-to-end test: verstuur encrypted bericht, ontvang + decrypt op andere client
- Key exchange test: verifieer hybrid secret is correct
- Quantum-proof: controleer dat ML-KEM encapsulation/decapsulation werkt
- Voice test: verifieer dat SFU alleen ciphertext forwardt
