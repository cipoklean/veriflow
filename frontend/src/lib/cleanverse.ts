/**
 * Cleanverse Cooperate API client (sandbox: https://uatapi.cleanverse.com/api/cooperate)
 *
 * Docs: v5.6. Selected endpoints require the request body to be AES/CBC/PKCS5
 * encrypted and sent as { "data": "<base64 ciphertext>" }.
 *   - Algorithm: AES-256-CBC
 *   - IV: 16 random bytes per encryption (crypto.getRandomValues) — NEVER a
 *     fixed/zero IV. The IV is prepended to the ciphertext so the recipient
 *     can decrypt: envelope data = base64( iv(16) || ciphertext ).
 *   - Key: Base64-decoded api-key (provided by Cleanverse, kept in .env, never hardcoded)
 *   - Body: { "data": "<base64(iv || AES(bytes(plaintextJSON)))>" }
 *
 * ⚠️ SECURITY NOTE (M-10): the AES key still lives in the frontend bundle via
 * VITE_CLEANVERSE_API_KEY. Anyone can extract it from the shipped JS. The
 * proper fix is server-side: see encryptBodyViaBackend() below — move the key
 * to a backend proxy that holds the secret and performs the encryption.
 *
 * Read/verify endpoints accept plain JSON (no encryption): /validator/verify,
 * /validator/is_register, /validator/rules, /validator/is_paused.
 */

const SANDBOX_BASE = 'https://uatapi.cleanverse.com/api/cooperate';

export const CLEANVERSE_BASE: string =
  (import.meta.env.VITE_CLEANVERSE_BASE as string | undefined) ||
  SANDBOX_BASE;

export const CLEANVERSE_API_ID: string | undefined = import.meta.env.VITE_CLEANVERSE_API_ID;
export const CLEANVERSE_API_KEY: string | undefined = import.meta.env.VITE_CLEANVERSE_API_KEY;

export function isCleanverseConfigured(): boolean {
  return !!CLEANVERSE_API_ID && !!CLEANVERSE_API_KEY;
}

// ── AES helpers (Web Crypto, no extra deps) ──────────────────────────────────

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function getAesKey(): Promise<CryptoKey> {
  if (!CLEANVERSE_API_KEY) throw new Error('Cleanverse API key not configured (VITE_CLEANVERSE_API_KEY)');
  const rawKey = base64ToBytes(CLEANVERSE_API_KEY);
  return crypto.subtle.importKey('raw', rawKey as BufferSource, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
}

const IV_LENGTH = 16;

/**
 * Encrypt a JSON-serializable object into the { data: "<b64>" } envelope.
 * Uses a FRESH random IV per call (never reused — fixes the old fixed-zero-IV
 * weakness). Envelope format: base64( iv(16) || ciphertext ).
 */
export async function encryptBody(payload: unknown): Promise<{ data: string }> {
  const key = await getAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: iv as BufferSource }, key, plaintext as BufferSource);
  // Prepend the IV so the recipient can decrypt without external IV exchange.
  const ivAndCipher = new Uint8Array(IV_LENGTH + cipherBuf.byteLength);
  ivAndCipher.set(iv, 0);
  ivAndCipher.set(new Uint8Array(cipherBuf), IV_LENGTH);
  return { data: bytesToBase64(ivAndCipher) };
}

/** Decrypt a { data: "<b64>" } envelope back to an object (expects iv || ciphertext). */
export async function decryptBody(envelope: { data: string }): Promise<any> {
  const key = await getAesKey();
  const ivAndCipher = base64ToBytes(envelope.data);
  if (ivAndCipher.length < IV_LENGTH) throw new Error('Cleanverse envelope too short (missing IV)');
  const iv = ivAndCipher.subarray(0, IV_LENGTH);
  const cipher = ivAndCipher.subarray(IV_LENGTH);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv as BufferSource }, key, cipher as BufferSource);
  return JSON.parse(new TextDecoder().decode(plainBuf));
}

/**
 * M-10 backend-proxy stub. The SECURE architecture moves the AES key server-side:
 * the frontend POSTs the plaintext payload to OUR backend, which encrypts with
 * the Cleanverse key (held in server env, never shipped) and forwards to
 * Cleanverse. This keeps the API key out of the browser bundle entirely.
 *
 * TODO: implement behind your backend (e.g. a Vercel/Express route that reads
 * CLEANVERSE_API_KEY from server env). Until then the client-side encryptBody
 * above is the active path.
 */
export async function encryptBodyViaBackend(payload: unknown, backendBase = '/api/cleanverse/encrypt'): Promise<{ data: string }> {
  const res = await fetch(backendBase, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Cleanverse backend proxy error ${res.status}`);
  const json = await res.json();
  if (!json?.data) throw new Error('Cleanverse backend proxy returned no envelope');
  return { data: json.data as string };
}

// ── Transport ────────────────────────────────────────────────────────────────

async function apiPost(path: string, body: unknown, encrypted: boolean): Promise<any> {
  if (!CLEANVERSE_API_ID) throw new Error('Cleanverse API id not configured (VITE_CLEANVERSE_API_ID)');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'api-id': CLEANVERSE_API_ID,
  };
  const payload = encrypted ? await encryptBody(body) : body;
  const res = await fetch(`${CLEANVERSE_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (json?.code && json.code !== '0000') {
    throw new Error(json.message || `Cleanverse error ${json.code}`);
  }
  return json;
}

async function apiPostPlain(path: string, body: unknown): Promise<any> {
  return apiPost(path, body, false);
}

// ── Public API surface ────────────────────────────────────────────────────────

export interface GenerateApassRequest {
  chain: string;
  customerId: string;
  idType: string; // e.g. "ID_CARD"
  identityDataList: Array<{
    field: string;
    value: string;
    issuingCountryISO2?: string;
  }>;
}

/** POST /generate_apass (encrypted) — issue an A-Pass for a wallet/identity. */
export async function generateApass(req: GenerateApassRequest): Promise<any> {
  return apiPost('/generate_apass', req, true);
}

export interface ValidatorRule {
  allowed_group?: string;
  allowed_sub_group?: string;
  min_tier?: number;
  min_sub_tier?: number;
  is_black_list?: boolean;
  countries?: string[];
}

/**
 * POST /validator/register (encrypted, owner signature required).
 * Registers a compliance pool (e.g. our VeriPair address) with the
 * APass Compliance Validator and sets its initial rule.
 */
export async function registerValidatorPool(params: {
  chain: string;
  contract_address: string;
  rule: ValidatorRule;
  owner_signature: string;
}): Promise<any> {
  return apiPost('/validator/register', params, true);
}

/** POST /validator/verify (plain JSON) — check a user against a pool's rules. */
export async function verifyUser(params: {
  chain: string;
  contract_address: string;
  user_address: string;
}): Promise<{ valid: boolean }> {
  const res = await apiPostPlain('/validator/verify', params);
  return { valid: !!res?.data?.valid };
}

/** POST /validator/is_register (plain JSON) — is this pool registered? */
export async function isPoolRegistered(params: { chain: string; contract_address: string }): Promise<boolean> {
  const res = await apiPostPlain('/validator/is_register', params);
  return !!res?.data?.registered;
}
