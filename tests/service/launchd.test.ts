import { describe, test, expect } from "bun:test";
import pino from "pino";
import { LaunchdController } from "../../src/services/os/launchd.js";

const noopLog = pino({ level: "silent" });
const isDarwin = process.platform === "darwin";

const suite = isDarwin ? describe : describe.skip;

suite("LaunchdController (darwin-only)", () => {
  const controller = new LaunchdController(noopLog);

  test("status returns a valid ServiceStatus value", async () => {
    const result = await controller.status();
    expect(["running", "stopped", "not-installed"]).toContain(result);
  });
});

describe("LaunchdController (unit, all platforms)", () => {
  test("class implements ServiceController interface", () => {
    const controller = new LaunchdController(noopLog);
    expect(typeof controller.install).toBe("function");
    expect(typeof controller.uninstall).toBe("function");
    expect(typeof controller.stop).toBe("function");
    expect(typeof controller.restart).toBe("function");
    expect(typeof controller.status).toBe("function");
  });
});
