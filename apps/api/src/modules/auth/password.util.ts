import crypto from 'node:crypto';

/**
 * Secure password hashing using Node.js crypto.scrypt (OWASP recommended memory/CPU parameters).
 * Format: scrypt$N$r$p$salt_hex$hash_hex
 */
const N = 16384; // CPU/memory cost
const r = 8;     // Block size
const p = 1;     // Parallelization
const KEY_LEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LEN, { N, r, p }, (err, derivedKey) => {
      if (err) return reject(err);
      const saltHex = salt.toString('hex');
      const hashHex = derivedKey.toString('hex');
      resolve(`scrypt$${N}$${r}$${p}$${saltHex}$${hashHex}`);
    });
  });
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash || !storedHash.startsWith('scrypt$')) {
    return false;
  }

  const parts = storedHash.split('$');
  if (parts.length !== 6) {
    return false;
  }

  const salt = Buffer.from(parts[4]!, 'hex');
  const expectedHash = Buffer.from(parts[5]!, 'hex');

  return new Promise((resolve) => {
    crypto.scrypt(password, salt, KEY_LEN, { N, r, p }, (err, derivedKey) => {
      if (err) return resolve(false);
      try {
        const match = crypto.timingSafeEqual(derivedKey, expectedHash);
        resolve(match);
      } catch {
        resolve(false);
      }
    });
  });
}

