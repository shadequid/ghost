import { describe, test, expect } from "bun:test";
import pino from "pino";
import { resolveServiceController, type ServiceController } from "../../src/services/os/controller.js";

const noopLog = pino({ level: "silent" });

describe("resolveServiceController", () => {
  test("returns a controller implementing the interface for current platform", () => {
    const ctrl = resolveServiceController(noopLog);
    expect(typeof ctrl.install).toBe("function");
    expect(typeof ctrl.uninstall).toBe("function");
    expect(typeof ctrl.stop).toBe("function");
    expect(typeof ctrl.restart).toBe("function");
    expect(typeof ctrl.status).toBe("function");
  });

  test("returns LaunchdController for darwin", () => {
    const ctrl = resolveServiceController(noopLog, "darwin");
    expect(typeof ctrl.install).toBe("function");
  });

  test("returns SystemdController for linux", () => {
    const ctrl = resolveServiceController(noopLog, "linux");
    expect(typeof ctrl.install).toBe("function");
  });

  test("returns SchtasksController for win32", () => {
    const ctrl = resolveServiceController(noopLog, "win32");
    expect(typeof ctrl.install).toBe("function");
  });

  test("throws on unsupported platform", () => {
    expect(() => resolveServiceController(noopLog, "freebsd" as NodeJS.Platform)).toThrow(
      /Unsupported platform/,
    );
  });
});
