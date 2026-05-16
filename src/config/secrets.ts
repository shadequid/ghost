import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { dirname } from "node:path";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX = "enc2:";

/**
 * AEAD secret store using AES-256-GCM.
 * Encrypted values are prefixed with "enc2:" and hex-encoded.
 * Plaintext values (no prefix) are passed through unchanged.
 */
export class SecretStore {
  private key: Buffer | null = null;

  constructor(private readonly keyPath: string) {}

  /**
   * Load the key from disk, or generate a new 32-byte key and save it with 0o600 permissions.
   * Returns the loaded or generated key.
   */
  async ensureKey(): Promise<Buffer> {
    if (this.key !== null) return this.key;

    if (existsSync(this.keyPath)) {
      const hex = readFileSync(this.keyPath, "utf-8").trim();
      this.key = Buffer.from(hex, "hex");
    } else {
      const dir = dirname(this.keyPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const newKey = randomBytes(KEY_BYTES);
      // Write with 0o600 permissions (owner read/write only)
      writeFileSync(this.keyPath, newKey.toString("hex"), { mode: 0o600 });
      this.key = newKey;
    }

    return this.key;
  }

  /** Encrypt plaintext → "enc2:" + hex(nonce || ciphertext || tag). */
  async encrypt(plaintext: string): Promise<string> {
    const key = await this.ensureKey();

    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, nonce);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf-8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    const combined = Buffer.concat([nonce, encrypted, tag]);
    return PREFIX + combined.toString("hex");
  }

  /**
   * Decrypt an "enc2:"-prefixed value.
   * Values without the prefix are returned unchanged (plaintext passthrough).
   */
  async decrypt(value: string): Promise<string> {
    if (!value.startsWith(PREFIX)) {
      return value;
    }

    const key = await this.ensureKey();

    const combined = Buffer.from(value.slice(PREFIX.length), "hex");

    if (combined.length < NONCE_BYTES + TAG_BYTES) {
      throw new Error("Invalid ciphertext: too short");
    }

    const nonce = combined.subarray(0, NONCE_BYTES);
    const tag = combined.subarray(combined.length - TAG_BYTES);
    const ciphertext = combined.subarray(NONCE_BYTES, combined.length - TAG_BYTES);

    const decipher = createDecipheriv(ALGORITHM, key, nonce);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString("utf-8");
  }
}
