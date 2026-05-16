import { describe, test, expect } from "bun:test";
import { waitForGatewayReachable } from "../../src/health/reachability.js";

describe("waitForGatewayReachable", () => {
  test("returns true when server is already listening", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    try {
      const ok = await waitForGatewayReachable({ port: server.port!, deadlineMs: 5_000 });
      expect(ok).toBe(true);
    } finally {
      server.stop();
    }
  });

  test("returns false when deadline elapses on unreachable port", async () => {
    // Port 1 is almost certainly not listening.
    const ok = await waitForGatewayReachable({ port: 1, deadlineMs: 500, pollMs: 100 });
    expect(ok).toBe(false);
  });

  test("returns true when server starts within deadline", async () => {
    // Use port: 0 for auto-assignment, get the port, stop, then restart on that port.
    const tmp = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    const port = tmp.port!;
    tmp.stop();

    const refs: Array<{ stop(): void }> = [];
    setTimeout(() => {
      refs.push(Bun.serve({ port, fetch: () => new Response("ok") }));
    }, 200);

    try {
      const ok = await waitForGatewayReachable({ port, deadlineMs: 3_000, pollMs: 100 });
      expect(ok).toBe(true);
    } finally {
      for (const s of refs) s.stop();
    }
  });
});
