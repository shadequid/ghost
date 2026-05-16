import { describe, test, expect } from "bun:test";
import { checkLingerStatus, type LingerResult } from "../../src/services/os/systemd-linger.js";

describe("checkLingerStatus", () => {
  test("returns null or a valid result object", () => {
    const result = checkLingerStatus();
    // On non-Linux or when loginctl is unavailable, result will be null.
    // On Linux with loginctl, result will have user + linger fields.
    if (result === null) {
      expect(result).toBeNull();
    } else {
      expect(typeof result.user).toBe("string");
      expect(result.user.length).toBeGreaterThan(0);
      expect(typeof result.linger).toBe("boolean");
    }
  });

  test("returns a user string matching current USER env when available", () => {
    const result = checkLingerStatus();
    if (result !== null && process.env.USER) {
      expect(result.user).toBe(process.env.USER);
    }
  });
});

describe("LingerResult type contract", () => {
  test("accepts all valid method values", () => {
    const results: LingerResult[] = [
      { enabled: true, method: "already" },
      { enabled: true, method: "passwordless" },
      { enabled: true, method: "sudo" },
      { enabled: false, method: "sudo", warning: "not enabled" },
    ];
    for (const r of results) {
      expect(typeof r.enabled).toBe("boolean");
      expect(["already", "passwordless", "sudo"]).toContain(r.method);
    }
  });
});
