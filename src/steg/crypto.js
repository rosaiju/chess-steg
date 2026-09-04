// AES-256-GCM encryption/decryption via Web Crypto API
// IV is derived from the password (not transmitted), saving 12 bytes per message.
// Tag length is 32 bits (4 bytes) instead of 128, saving another 12 bytes.
// Total overhead: 4 bytes (tag only) instead of 28 bytes (IV + 128-bit tag).

const ALGO = { name: "AES-GCM", length: 256 };
const TAG_LENGTH = 32; // bits — valid values: 32,64,96,104,112,120,128

async function deriveKey(password) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("chess-steg-key"), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    ALGO,
    false,
    ["encrypt", "decrypt"]
  );
}

async function deriveIV(password) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode("chess-steg-iv"), iterations: 1000, hash: "SHA-256" },
    keyMaterial,
    96 // 12 bytes
  );
  return new Uint8Array(bits);
}

// Encrypt plaintext → base64 string (ciphertext + 8-byte tag only; IV is derived from password)
export async function encrypt(plaintext, password) {
  const [key, iv] = await Promise.all([deriveKey(password), deriveIV(password)]);
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: TAG_LENGTH },
    key,
    enc.encode(plaintext)
  );
  return btoa(String.fromCharCode(...new Uint8Array(ciphertext)));
}

// Decrypt base64 string → plaintext (IV re-derived from password)
export async function decrypt(b64, password) {
  const [key, iv] = await Promise.all([deriveKey(password), deriveIV(password)]);
  const ciphertext = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const dec = new TextDecoder();
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: TAG_LENGTH },
    key,
    ciphertext
  );
  return dec.decode(plaintext);
}
