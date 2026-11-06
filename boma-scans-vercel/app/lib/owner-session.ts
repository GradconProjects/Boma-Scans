/**
 * Owner sign-in primitives (WebCrypto only, so they run on Vercel and in Node tests).
 *
 * - The login password can be short (a PIN) because it is checked online with
 *   throttling and stored as a salted PBKDF2 hash; it is never the cookie key.
 * - The session cookie is an HMAC over an expiry, keyed by signing material
 *   that is hashed to 32 bytes (env secret plus a random server salt when a
 *   database is available).
 */
const encoder = new TextEncoder();
const lifetime = 90 * 86_400_000; // 90-day owner session
export const MIN_PASSWORD_LENGTH = 4;
export const PBKDF2_ITERATIONS = 150_000;

const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const decode = (text: string) => Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));

async function hmacKey(material: string) {
  const raw = await crypto.subtle.digest("SHA-256", encoder.encode("boma-sign:" + material));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createOwnerSession(material: string, now = Date.now()) {
  if (!material) throw new Error("Signing material is required.");
  const expires = String(now + lifetime);
  return expires + "." + encode(new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(material), encoder.encode("boma-sync:" + expires))));
}

export async function validOwnerSession(token: string, material: string, now = Date.now()) {
  if (!material || token.length > 180) return false;
  const [expires, signature] = token.split(".");
  if (!/^\d+$/.test(expires) || !signature || Number(expires) <= now || Number(expires) > now + lifetime + 60_000) return false;
  try {
    return await crypto.subtle.verify("HMAC", await hmacKey(material), decode(signature), encoder.encode("boma-sync:" + expires));
  } catch { return false; }
}

/** Constant-time comparison of two strings via their digests. */
export async function equalSecret(expected: string, actual: string) {
  const a = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(expected)));
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(actual)));
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
  return different === 0;
}

export type PasswordRecord = { salt: string; hash: string; iterations: number; updatedAt: number };

export async function hashPassword(password: string, salt?: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<PasswordRecord> {
  const saltBytes = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes as BufferSource, iterations }, key, 256);
  return { salt: encode(saltBytes), hash: encode(new Uint8Array(bits)), iterations, updatedAt: Date.now() };
}

export async function verifyPassword(password: string, record: PasswordRecord) {
  try {
    const candidate = await hashPassword(password, decode(record.salt), record.iterations);
    return equalSecret(record.hash, candidate.hash);
  } catch { return false; }
}

export function randomMaterial() {
  return encode(crypto.getRandomValues(new Uint8Array(32)));
}
