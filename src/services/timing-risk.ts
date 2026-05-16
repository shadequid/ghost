/**
 * Timing risk service — detects timing-related trading risks.
 * Weekend/holiday, post-volatility, upcoming macro events.
 */

import type { ITradingClient } from "./interfaces/trading-client.js";
import type { TaIndicatorService } from "./ta-indicators.js";

// ─── Types ───

export interface TimingRiskFactor {
  type: "weekend" | "holiday" | "post_volatility" | "event" | "low_liquidity";
  severity: "low" | "medium" | "high";
  description: string;
}

// ─── Known events ───

/** FOMC meeting dates (approximate — updated periodically). */
const FOMC_DATES_2025 = [
  "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18",
  "2025-07-30", "2025-09-17", "2025-10-29", "2025-12-10",
];

const FOMC_DATES_2026 = [
  "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17",
  "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
];

/** CPI release dates (approximate). */
const CPI_DATES_2025 = [
  "2025-01-15", "2025-02-12", "2025-03-12", "2025-04-10",
  "2025-05-13", "2025-06-11", "2025-07-11", "2025-08-12",
  "2025-09-10", "2025-10-14", "2025-11-12", "2025-12-10",
];

const CPI_DATES_2026 = [
  "2026-01-14", "2026-02-11", "2026-03-11", "2026-04-14",
  "2026-05-12", "2026-06-10", "2026-07-14", "2026-08-12",
  "2026-09-11", "2026-10-13", "2026-11-12", "2026-12-10",
];

/** US federal holidays. */
const US_HOLIDAYS_2025: Record<string, string> = {
  "2025-01-01": "New Year's Day",
  "2025-01-20": "MLK Day",
  "2025-02-17": "Presidents' Day",
  "2025-05-26": "Memorial Day",
  "2025-07-04": "Independence Day",
  "2025-09-01": "Labor Day",
  "2025-11-27": "Thanksgiving",
  "2025-12-25": "Christmas",
};

const US_HOLIDAYS_2026: Record<string, string> = {
  "2026-01-01": "New Year's Day",
  "2026-01-19": "MLK Day",
  "2026-02-16": "Presidents' Day",
  "2026-05-25": "Memorial Day",
  "2026-07-04": "Independence Day",
  "2026-09-07": "Labor Day",
  "2026-11-26": "Thanksgiving",
  "2026-12-25": "Christmas",
};

// ─── Service ───

export class TimingRiskService {
  constructor(
    private readonly hl: ITradingClient,
    private readonly taIndicators: TaIndicatorService,
  ) {}

  /** Get timing risks for a symbol. */
  async getTimingRisks(
    symbol: string,
    timezone?: string,
  ): Promise<TimingRiskFactor[]> {
    const risks: TimingRiskFactor[] = [];
    const tz = timezone ?? "UTC";
    const now = new Date();

    // Weekend detection
    const dayOfWeek = getDayInTimezone(now, tz);
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      risks.push({
        type: "weekend",
        severity: "medium",
        description: "Weekend trading \u2014 lower liquidity, wider spreads, higher slippage risk.",
      });
    }

    // Holiday detection
    const todayStr = getDateStringInTimezone(now, tz);
    const tomorrowStr = getDateStringInTimezone(new Date(now.getTime() + 86_400_000), tz);
    const allHolidays = { ...US_HOLIDAYS_2025, ...US_HOLIDAYS_2026 };

    if (allHolidays[todayStr]) {
      risks.push({
        type: "holiday",
        severity: "medium",
        description: `US holiday today (${allHolidays[todayStr]}) \u2014 reduced institutional activity.`,
      });
    } else if (allHolidays[tomorrowStr]) {
      risks.push({
        type: "holiday",
        severity: "low",
        description: `US holiday tomorrow (${allHolidays[tomorrowStr]}) \u2014 expect reduced activity.`,
      });
    }

    // Post-volatility detection via ATR
    try {
      const indicators = await this.taIndicators.getIndicators(symbol, "1h", ["volatility"]);
      const atrPct = indicators.volatility.atrPct;

      if (!isNaN(atrPct)) {
        // Get recent klines to check for big candles
        const klines = await this.hl.getKlines(symbol, "1h", 24);
        if (klines.length >= 3) {
          const latestRange = klines[klines.length - 1].high - klines[klines.length - 1].low;
          const latestRangePct = (latestRange / klines[klines.length - 1].close) * 100;
          if (latestRangePct > atrPct * 2) {
            risks.push({
              type: "post_volatility",
              severity: "high",
              description: `Recent candle range (${latestRangePct.toFixed(2)}%) is >2x ATR (${atrPct.toFixed(2)}%) \u2014 post-volatility, spreads may be wide.`,
            });
          }
        }
      }
    } catch {
      // TA data unavailable — skip post-volatility check
    }

    // Upcoming macro events
    const allFomc = [...FOMC_DATES_2025, ...FOMC_DATES_2026];
    const allCpi = [...CPI_DATES_2025, ...CPI_DATES_2026];

    const nearestFomc = findNearestUpcoming(todayStr, allFomc);
    if (nearestFomc) {
      const daysUntil = daysBetween(todayStr, nearestFomc);
      if (daysUntil === 0) {
        risks.push({
          type: "event",
          severity: "high",
          description: "FOMC meeting TODAY \u2014 expect high volatility around announcement.",
        });
      } else if (daysUntil <= 2) {
        risks.push({
          type: "event",
          severity: "medium",
          description: `FOMC meeting in ${daysUntil} day(s) (${nearestFomc}) \u2014 market may be cautious.`,
        });
      }
    }

    const nearestCpi = findNearestUpcoming(todayStr, allCpi);
    if (nearestCpi) {
      const daysUntil = daysBetween(todayStr, nearestCpi);
      if (daysUntil === 0) {
        risks.push({
          type: "event",
          severity: "high",
          description: "CPI data release TODAY \u2014 expect volatility on print.",
        });
      } else if (daysUntil <= 2) {
        risks.push({
          type: "event",
          severity: "medium",
          description: `CPI release in ${daysUntil} day(s) (${nearestCpi}) \u2014 may affect positioning.`,
        });
      }
    }

    // Low liquidity hours (very rough heuristic)
    const hourInUtc = now.getUTCHours();
    if (hourInUtc >= 21 || hourInUtc < 2) {
      risks.push({
        type: "low_liquidity",
        severity: "low",
        description: "Late UTC hours \u2014 traditionally lower liquidity, larger spreads possible.",
      });
    }

    return risks;
  }
}

// ─── Date helpers ───

function getDayInTimezone(date: Date, tz: string): number {
  try {
    const str = date.toLocaleDateString("en-US", { timeZone: tz, weekday: "short" });
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return dayMap[str] ?? date.getUTCDay();
  } catch {
    return date.getUTCDay();
  }
}

function getDateStringInTimezone(date: Date, tz: string): string {
  try {
    const parts = date.toLocaleDateString("en-CA", { timeZone: tz });
    return parts; // en-CA gives YYYY-MM-DD format
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function findNearestUpcoming(today: string, dates: string[]): string | null {
  for (const d of dates.sort()) {
    if (d >= today) return d;
  }
  return null;
}

function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA + "T00:00:00Z");
  const b = new Date(dateB + "T00:00:00Z");
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}
