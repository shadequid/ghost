/**
 * Reachability probe — polls an HTTP endpoint until it responds or the deadline elapses.
 * Used after service install to confirm the daemon actually started.
 */

export interface ReachabilityOptions {
  port: number;
  host?: string;
  deadlineMs: number;
  pollMs?: number;
}

export async function waitForGatewayReachable(opts: ReachabilityOptions): Promise<boolean> {
  const host = opts.host ?? "127.0.0.1";
  const poll = opts.pollMs ?? 250;
  const deadline = Date.now() + opts.deadlineMs;
  const url = `http://${host}:${opts.port}/`;

  while (Date.now() < deadline) {
    try {
      const remaining = deadline - Date.now();
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), Math.min(500, remaining));
      const resp = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timeout);
      if (resp.status > 0) return true;
    } catch {
      // Connection refused, timeout, etc. — retry.
    }
    await Bun.sleep(poll);
  }
  return false;
}
