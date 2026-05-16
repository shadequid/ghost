import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretStore } from "../../../src/config/secrets.js";
import { CredentialStore } from "../../../src/config/credentials.js";
import { initDatabase } from "../../../src/core/database.js";
import { PairingStore } from "../../../src/pairing/store.js";
import { NOOP_LOGGER } from "../../../src/logger.js";
import { telegramPlugin, type ProbeResult } from "../../../src/channels/telegram/plugin.js";

// Override the private probe() method on the singleton telegramPlugin so tests
// can drive success/failure without hitting the real Telegram API.
const fakeProbe = mock(async (_token: string): Promise<ProbeResult> => ({ ok: true, username: "stub_bot" }));
(telegramPlugin as unknown as { probe: typeof fakeProbe }).probe = fakeProbe;

let tmp: string;
let credentials: CredentialStore;
let pairingStore: PairingStore;

beforeEach(() => {
  tmp = join(tmpdir(), `ghost-plugin-tg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
  process.env["GHOST_HOME"] = tmp;
  const secretStore = new SecretStore(join(tmp, ".secret_key"));
  credentials = new CredentialStore(join(tmp, "credentials.json"), secretStore, NOOP_LOGGER);
  pairingStore = new PairingStore(initDatabase(":memory:"), NOOP_LOGGER);
  fakeProbe.mockReset();
  fakeProbe.mockImplementation(async () => ({ ok: true, username: "stub_bot" }));
});

afterEach(() => {
  delete process.env["GHOST_HOME"];
  rmSync(tmp, { recursive: true, force: true });
});

describe("telegramPlugin.setup", () => {
  test("stores token on success", async () => {
    const res = await telegramPlugin.setup({ credentials, token: "123:abc" });
    expect(res.summary).toContain("stub_bot");
    expect(await credentials.get("telegram_token")).toBe("123:abc");
  });

  test("throws on probe rejection", async () => {
    fakeProbe.mockImplementation(async () => ({ ok: false as const, error: "Unauthorized" }));
    await expect(telegramPlugin.setup({ credentials, token: "bad" })).rejects.toThrow(/Unauthorized/);
  });
});

describe("telegramPlugin.status", () => {
  test("no token → not configured", async () => {
    const res = await telegramPlugin.status({ credentials, probe: false });
    expect(res.enabled).toBe(false);
    expect(res.summary).toContain("not configured");
  });

  test("token present + probe=false → healthy without network call", async () => {
    await credentials.set("telegram_token", "tok");
    const res = await telegramPlugin.status({ credentials, probe: false });
    expect(fakeProbe).not.toHaveBeenCalled();
    expect(res.enabled).toBe(true);
    expect(res.healthy).toBe(true);
  });

  test("token present + probe=true returns bot username", async () => {
    await credentials.set("telegram_token", "tok");
    const res = await telegramPlugin.status({ credentials, probe: true });
    expect(res.healthy).toBe(true);
    expect(res.detail["bot"]).toBe("stub_bot");
  });

  test("probe failure → healthy=false with error", async () => {
    await credentials.set("telegram_token", "tok");
    fakeProbe.mockImplementation(async () => ({ ok: false as const, error: "network error" }));
    const res = await telegramPlugin.status({ credentials, probe: true });
    expect(res.enabled).toBe(true);
    expect(res.healthy).toBe(false);
    expect(res.error).toBe("network error");
  });
});

describe("telegramPlugin.remove", () => {
  test("removes token and clears pairing", async () => {
    await credentials.set("telegram_token", "tok");
    const res = await telegramPlugin.remove({ credentials, pairingStore });
    expect(res.summary).toContain("disabled");
    expect(await credentials.get("telegram_token")).toBeNull();
  });

  test("remove with no token still returns summary", async () => {
    const res = await telegramPlugin.remove({ credentials, pairingStore });
    expect(res.summary).toBeTruthy();
  });
});
