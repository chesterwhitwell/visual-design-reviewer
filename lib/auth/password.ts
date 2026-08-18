import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
const KEY_LENGTH = 32;
const N = 32_768;
const R = 8;
const P = 1;
const MAX_MEMORY = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derive(password, salt, N, R, P);
  return [
    "scrypt-v1",
    `N=${N},r=${R},p=${P}`,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join(":");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return false;
  const actual = await derive(password, parsed.salt, parsed.n, parsed.r, parsed.p);
  return actual.length === parsed.hash.length && timingSafeEqual(actual, parsed.hash);
}

function parsePasswordHash(value: string) {
  const [version, parameters, saltValue, hashValue, extra] = value.split(":");
  if (version !== "scrypt-v1" || !parameters || !saltValue || !hashValue || extra) return null;
  const match = /^N=(\d+),r=(\d+),p=(\d+)$/.exec(parameters);
  if (!match) return null;
  const n = Number(match[1]);
  const r = Number(match[2]);
  const p = Number(match[3]);
  if (n !== N || r !== R || p !== P) return null;
  try {
    const salt = Buffer.from(saltValue, "base64url");
    const hash = Buffer.from(hashValue, "base64url");
    if (salt.length !== 16 || hash.length !== KEY_LENGTH) return null;
    return { n, r, p, salt, hash };
  } catch {
    return null;
  }
}

async function derive(password: string, salt: Buffer, n: number, r: number, p: number) {
  return new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(password, salt, KEY_LENGTH, {
      N: n,
      r,
      p,
      maxmem: MAX_MEMORY,
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(Buffer.from(derivedKey));
    });
  });
}
