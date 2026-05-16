import { describe, test, expect, mock } from "bun:test";
import { runProactiveCommand } from "../../src/commands/proactive";

const noopLogger = { info: mock(), warn: mock(), error: mock() } as any;

describe("ghost proactive", () => {
  test("on writes config.observer.enabled=true", async () => {
    const config = { observer: { enabled: false } } as any;
    const writeConfig = mock();
    await runProactiveCommand("on", { config, writeConfig, logger: noopLogger });
    expect(writeConfig).toHaveBeenCalled();
    expect(config.observer.enabled).toBe(true);
  });

  test("off writes config.observer.enabled=false", async () => {
    const config = { observer: { enabled: true } } as any;
    const writeConfig = mock();
    await runProactiveCommand("off", { config, writeConfig, logger: noopLogger });
    expect(config.observer.enabled).toBe(false);
  });

  test("status returns enabled flag and timezone", async () => {
    const config = { observer: { enabled: true } } as any;
    const result = await runProactiveCommand("status", { config, writeConfig: mock(), logger: noopLogger });
    expect(result.enabled).toBe(true);
    expect(typeof result.timezone).toBe("string");
    expect(result.timezone.length).toBeGreaterThan(0);
  });

  test("status does not call writeConfig", async () => {
    const config = { observer: { enabled: true } } as any;
    const writeConfig = mock();
    await runProactiveCommand("status", { config, writeConfig, logger: noopLogger });
    expect(writeConfig).not.toHaveBeenCalled();
  });
});
