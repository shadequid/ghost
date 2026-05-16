import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SecretStore } from "../../src/config/secrets.js";
import { join } from "node:path";
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";

let tmpDir: string;
let keyPath: string;
let store: SecretStore;

describe("SecretStore", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ghost-secrets-test-"));
    keyPath = join(tmpDir, ".secret_key");
    store = new SecretStore(keyPath);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("round-trip: encrypt then decrypt returns original plaintext", async () => {
    await store.ensureKey();
    const plaintext = "my super secret API key";
    const ciphertext = await store.encrypt(plaintext);
    expect(ciphertext.startsWith("enc2:")).toBe(true);
    const recovered = await store.decrypt(ciphertext);
    expect(recovered).toBe(plaintext);
  });

  test("different nonces: encrypting same value twice gives different ciphertext", async () => {
    await store.ensureKey();
    const plaintext = "same input";
    const c1 = await store.encrypt(plaintext);
    const c2 = await store.encrypt(plaintext);
    expect(c1).not.toBe(c2);
    // But both decrypt to the same value
    expect(await store.decrypt(c1)).toBe(plaintext);
    expect(await store.decrypt(c2)).toBe(plaintext);
  });

  test("tamper detection: modified ciphertext throws", async () => {
    await store.ensureKey();
    const ciphertext = await store.encrypt("secret");
    const tampered = ciphertext.slice(0, -4) + "beef";
    await expect(store.decrypt(tampered)).rejects.toThrow();
  });

  test("plaintext passthrough: values without enc2: prefix returned unchanged", async () => {
    await store.ensureKey();
    const plaintext = "just a regular string";
    const result = await store.decrypt(plaintext);
    expect(result).toBe(plaintext);
  });

  test("empty string passthrough: empty string returned unchanged", async () => {
    await store.ensureKey();
    const result = await store.decrypt("");
    expect(result).toBe("");
  });

  test("key file creation: ensureKey creates file with restricted permissions", async () => {
    expect(existsSync(keyPath)).toBe(false);
    await store.ensureKey();
    expect(existsSync(keyPath)).toBe(true);
    // Check 0o600 permissions (owner read/write only)
    const stat = statSync(keyPath);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
