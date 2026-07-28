import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Local-password hashing for Settings > Security's Create/Change Password
 * feature. Uses Node's built-in `crypto.scrypt` rather than adding bcrypt/
 * argon2 as a dependency ("simplicity beats cleverness", `docs/VISION.md`) -
 * scrypt is a real, still-recommended password-hashing KDF, and needs no
 * native binding.
 *
 * Stored format: "<saltHex>:<hashHex>", one column
 * (`User.passwordHash`) - `SCRYPT_KEY_LENGTH` and the salt length are fixed
 * constants rather than parameters, so there's nothing to migrate if they
 * never change; if they ever do, this format still records the salt
 * per-user, so re-hashing on next password change is enough - no bulk
 * migration required.
 */
const SCRYPT_KEY_LENGTH = 64;
const SALT_LENGTH_BYTES = 16;

/** Shared by Settings' create/change password and the /login, /create-account Server Actions. */
export const MINIMUM_PASSWORD_LENGTH = 8;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH_BYTES);
  const derivedKey = await scryptAsync(password, salt);

  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

/**
 * `crypto.timingSafeEqual`, not `===` - same discipline this codebase
 * already applies to bearer-token comparisons (`CRON_SECRET`,
 * `FUSIONSOLAR_GATEWAY_SECRET`), applied here to password verification.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [saltHex, hashHex] = storedHash.split(":");

  if (!saltHex || !hashHex) {
    return false;
  }

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, salt);

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}
