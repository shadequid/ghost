/**
 * GET /health — public endpoint, no auth required.
 */
export function handleHealth(): {
  status: string;
  uptime_seconds: number;
} {
  return {
    status: "ok",
    uptime_seconds: Math.floor(process.uptime()),
  };
}
