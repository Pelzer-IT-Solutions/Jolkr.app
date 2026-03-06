/**
 * Voice E2EE — Frame Encryption Worker
 *
 * Encrypts/decrypts WebRTC audio frames using AES-256-GCM.
 * Runs in a dedicated Web Worker, driven by RTCRtpScriptTransform.
 *
 * Frame format (encrypted):
 *   [encrypted payload + 16-byte GCM tag] [4-byte counter LE]
 *
 * IV (12 bytes):
 *   [SSRC 4B big-endian] [counter 4B little-endian] [0x00 0x00 0x00 0x00]
 *
 * The SSRC is per-sender and available from frame metadata, preventing IV
 * collisions when multiple senders share the same key.
 */

let voiceKey: CryptoKey | null = null;
let sendCounter = 0;

// ── Main thread messages ────────────────────────────────────────────

self.onmessage = async (event: MessageEvent) => {
  const { type, keyBytes } = event.data;
  if (type === 'setKey' && keyBytes instanceof ArrayBuffer) {
    // Derive a voice-specific key from the channel key via HKDF
    const baseKey = await crypto.subtle.importKey(
      'raw', keyBytes, 'HKDF', false, ['deriveKey'],
    );
    voiceKey = await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        salt: new Uint8Array(32),
        info: new TextEncoder().encode('jolkr-voice-e2ee-v1'),
        hash: 'SHA-256',
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    sendCounter = 0;
  } else if (type === 'clearKey') {
    voiceKey = null;
    sendCounter = 0;
  }
};

// ── RTCRtpScriptTransform handler ───────────────────────────────────

// @ts-expect-error onrtctransform is not in DOM types (worker-only API)
self.onrtctransform = (event: {
  transformer: {
    readable: ReadableStream;
    writable: WritableStream;
    options: { operation: string };
  };
}) => {
  const { readable, writable, options } = event.transformer;
  const isEncrypt = options.operation === 'encrypt';

  readable
    .pipeThrough(new TransformStream({ transform: isEncrypt ? encryptFrame : decryptFrame }))
    .pipeTo(writable);
};

// ── Frame encryption ────────────────────────────────────────────────

function buildIV(ssrc: number, counter: number): ArrayBuffer {
  const iv = new ArrayBuffer(12);
  const dv = new DataView(iv);
  dv.setUint32(0, ssrc, false);  // SSRC big-endian
  dv.setUint32(4, counter, true); // counter little-endian
  return iv;
}

async function encryptFrame(
  frame: RTCEncodedAudioFrame,
  controller: TransformStreamDefaultController,
) {
  if (!voiceKey) {
    controller.enqueue(frame);
    return;
  }

  const data = frame.data;
  const counter = sendCounter++;
  const ssrc = frame.getMetadata().synchronizationSource ?? 0;
  const iv = buildIV(ssrc, counter);

  try {
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      voiceKey,
      data,
    );

    // [encrypted + tag] [4-byte counter LE]
    const result = new ArrayBuffer(encrypted.byteLength + 4);
    new Uint8Array(result).set(new Uint8Array(encrypted), 0);
    new DataView(result).setUint32(encrypted.byteLength, counter, true);

    frame.data = result;
  } catch {
    // Encryption failed — send unencrypted
  }
  controller.enqueue(frame);
}

// ── Frame decryption ────────────────────────────────────────────────

async function decryptFrame(
  frame: RTCEncodedAudioFrame,
  controller: TransformStreamDefaultController,
) {
  if (!voiceKey) {
    controller.enqueue(frame);
    return;
  }

  const data = frame.data;
  // Minimum: 1 byte payload + 16 GCM tag + 4 counter = 21
  if (data.byteLength < 21) {
    controller.enqueue(frame);
    return;
  }

  const fullView = new DataView(data);
  const counter = fullView.getUint32(data.byteLength - 4, true);
  const ciphertext = data.slice(0, data.byteLength - 4);

  const ssrc = frame.getMetadata().synchronizationSource ?? 0;
  const iv = buildIV(ssrc, counter);

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      voiceKey,
      ciphertext,
    );
    frame.data = decrypted;
  } catch {
    // Decryption failed — pass through (unencrypted frame or key mismatch)
  }
  controller.enqueue(frame);
}
