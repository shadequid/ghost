import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import pino from "pino";

// Shared gate: when true, mocks intercept; when false, real implementations run.
// This prevents cross-file module registry bleed when tests run together.
let _intercepting = false;
let _fetchLatestResult: string | null = null;
let _getCurrentResult: string = "0.0.1";

// Capture real function references BEFORE mock.module() replaces the module.
// After mock.module() the registry entry is replaced, but these captured
// closures still point to the original implementations — no infinite recursion.
const realVersionCheck = await import("../../src/update/version-check.js");
const realVersion = await import("../../src/update/version.js");
const _realFetchLatestVersion = realVersionCheck.fetchLatestVersion;
const _realGetCurrentVersion = realVersion.getCurrentVersion;

mock.module("../../src/update/version-check.ts", () => ({
  ...realVersionCheck,
  fetchLatestVersion: async (opts: Parameters<typeof _realFetchLatestVersion>[0]) => {
    if (_intercepting) return _fetchLatestResult;
    // Delegate to the captured real fn (not the mock binding) — no recursion.
    return _realFetchLatestVersion(opts);
  },
}));

mock.module("../../src/update/version.ts", () => ({
  ...realVersion,
  getCurrentVersion: (pkgPath?: string | null) => {
    if (_intercepting) return _getCurrentResult;
    return _realGetCurrentVersion(pkgPath);
  },
}));

// Import the SUT after mocks are registered so it picks up the interceptors.
const { runVersion } = await import("../../src/commands/version.js");

const logger = pino({ level: "silent" });

let logSpy: ReturnType<typeof spyOn<typeof console, "log">>;

beforeEach(() => {
  _fetchLatestResult = null;
  _getCurrentResult = "0.0.1";
  _intercepting = true;
  logSpy = spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  _intercepting = false;
  logSpy.mockRestore();
});

describe("runVersion", () => {
  test("plain: prints current + hint when latest is newer", async () => {
    _getCurrentResult = "0.0.1";
    _fetchLatestResult = "99.0.0";
    await runVersion({ json: false, logger });
    expect(logSpy.mock.calls).toHaveLength(2);
    expect(logSpy.mock.calls[0]![0]).toBe("0.0.1");
    expect(logSpy.mock.calls[1]![0]).toBe(
      "(update available: v99.0.0 — run `ghost update`)",
    );
  });

  test("plain: prints current only when up-to-date", async () => {
    _getCurrentResult = "0.0.1";
    _fetchLatestResult = "0.0.1";
    await runVersion({ json: false, logger });
    expect(logSpy.mock.calls).toHaveLength(1);
    expect(logSpy.mock.calls[0]![0]).toBe("0.0.1");
  });

  test("plain: prints current only when latest is older than current", async () => {
    _getCurrentResult = "0.1.0";
    _fetchLatestResult = "0.0.0";
    await runVersion({ json: false, logger });
    expect(logSpy.mock.calls).toHaveLength(1);
    expect(logSpy.mock.calls[0]![0]).toBe("0.1.0");
  });

  test("plain: prints current only when fetch fails", async () => {
    _getCurrentResult = "0.0.1";
    _fetchLatestResult = null;
    await runVersion({ json: false, logger });
    expect(logSpy.mock.calls).toHaveLength(1);
    expect(logSpy.mock.calls[0]![0]).toBe("0.0.1");
  });

  test("plain: prints current only when fetch returns null (e.g. 500)", async () => {
    _getCurrentResult = "0.0.1";
    _fetchLatestResult = null;
    await runVersion({ json: false, logger });
    expect(logSpy.mock.calls).toHaveLength(1);
    expect(logSpy.mock.calls[0]![0]).toBe("0.0.1");
  });

  test("plain: suppresses hint when current is 'unknown' even on successful fetch", async () => {
    _getCurrentResult = "unknown";
    _fetchLatestResult = "1.0.0";
    await runVersion({ json: false, logger });
    expect(logSpy.mock.calls).toHaveLength(1);
    expect(logSpy.mock.calls[0]![0]).toBe("unknown");
  });

  test("json: includes latest and updateAvailable=true when newer", async () => {
    _getCurrentResult = "0.0.1";
    _fetchLatestResult = "99.0.0";
    await runVersion({ json: true, logger });
    expect(logSpy.mock.calls).toHaveLength(1);
    expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toEqual({
      current: "0.0.1",
      latest: "99.0.0",
      updateAvailable: true,
    });
  });

  test("json: updateAvailable=false when up-to-date", async () => {
    _getCurrentResult = "0.0.1";
    _fetchLatestResult = "0.0.1";
    await runVersion({ json: true, logger });
    expect(logSpy.mock.calls).toHaveLength(1);
    expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toEqual({
      current: "0.0.1",
      latest: "0.0.1",
      updateAvailable: false,
    });
  });

  test("json: latest=null and updateAvailable=false on fetch failure", async () => {
    _getCurrentResult = "0.0.1";
    _fetchLatestResult = null;
    await runVersion({ json: true, logger });
    expect(logSpy.mock.calls).toHaveLength(1);
    expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toEqual({
      current: "0.0.1",
      latest: null,
      updateAvailable: false,
    });
  });

  test("json: updateAvailable=false when current is 'unknown' even with successful fetch", async () => {
    _getCurrentResult = "unknown";
    _fetchLatestResult = "1.0.0";
    await runVersion({ json: true, logger });
    expect(logSpy.mock.calls).toHaveLength(1);
    expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toEqual({
      current: "unknown",
      latest: "1.0.0",
      updateAvailable: false,
    });
  });
});
