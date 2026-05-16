interface FriendlyError {
  message: string;
  detail: string;
}

const PATTERNS: Array<{ test: RegExp; message: string }> = [
  // Connection
  { test: /not connected|connection closed|websocket/i, message: 'Ghost is not running — please start Ghost first' },

  // Source-specific rate limits (order matters — specific before generic)
  { test: /coingecko.*rate|coingecko.*429/i, message: 'CoinGecko rate limit — wait a minute' },
  { test: /hyperliquid.*429|hyperliquid.*rate|hyperliquid.*too many/i, message: 'Hyperliquid rate limit — try again shortly' },
  { test: /openrouter.*429|openrouter.*rate/i, message: 'OpenRouter rate limit — try again shortly' },
  { test: /anthropic.*429|anthropic.*rate|anthropic.*overloaded/i, message: 'Anthropic rate limit — try again shortly' },
  { test: /openai.*429|openai.*rate/i, message: 'OpenAI rate limit — try again shortly' },
  { test: /google.*429|google.*rate/i, message: 'Google rate limit — try again shortly' },
  { test: /Rate limit exceeded/i, message: 'Too many requests — try again in a moment' },
  { test: /429|rate.?limit|too many/i, message: 'Rate limit hit — try again shortly' },

  // Provider errors
  { test: /overloaded/i, message: 'AI provider overloaded — try again shortly' },
  { test: /insufficient.*credit|quota.*exceeded|billing/i, message: 'AI provider quota exceeded — check your API credits' },
  { test: /invalid.*api.?key|invalid.*key/i, message: 'Invalid API key — check provider settings' },
  { test: /model.*not.*found|model.*unavailable/i, message: 'Model not available — check provider settings' },

  // Server errors
  { test: /500|internal/i, message: 'Internal error — try again or restart Ghost' },
  { test: /503|service unavailable/i, message: 'Service unavailable — try again in a moment' },

  // Auth
  { test: /unauthorized|session expired/i, message: 'Session expired — please refresh' },

  // Timeouts & cancellation
  { test: /timeout/i, message: 'Request timed out — try again' },
  { test: /abort/i, message: 'Request was cancelled' },
];

export function friendlyError(raw: string): FriendlyError {
  for (const { test, message } of PATTERNS) {
    if (test.test(raw)) return { message, detail: raw };
  }
  return { message: 'Unexpected error — try again or restart Ghost', detail: raw };
}
