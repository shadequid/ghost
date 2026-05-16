/**
 * Intel service — consolidated CoinGecko + DefiLlama + Alternative.me adapters.
 */

// ─── Types ───

export interface FearGreedData {
  value: number;
  classification: string;
  timestamp: number;
  history?: { value: number; classification: string; timestamp: number }[];
}

export interface MarketOverview {
  totalMarketCap: number;
  totalVolume24h: number;
  btcDominance: number;
  ethDominance: number;
  marketCapChangePct24h: number;
}

export interface TrendingCoin {
  id: string;
  symbol: string;
  name: string;
  rank: number;
  price: number;
  priceChangePct24h: number;
  marketCap: number;
}

export interface TVLData {
  chain?: string;
  protocol?: string;
  tvl: number;
  tvlChangePct1d: number;
  tvlChangePct7d: number;
}

export interface StablecoinData {
  name: string;
  symbol: string;
  supply: number;
  supplyChangePct7d: number;
}

export interface FullOverview {
  fearGreed: FearGreedData | null;
  market: MarketOverview | null;
  trending: TrendingCoin[];
  totalTvl: number;
  stablecoinSupply: number;
}

// ─── Service ───

export class IntelService {

  // ─── Alternative.me: Fear & Greed ───

  async getFearGreed(days = 7): Promise<FearGreedData> {
    const res = await fetch(`https://api.alternative.me/fng/?limit=${days + 1}&format=json`);
    if (!res.ok) throw new Error(`Alternative.me: ${res.status}`);
    const data = await res.json() as any;
    const entries = data.data ?? [];
    if (entries.length === 0) throw new Error("No Fear & Greed data");

    const current = entries[0];
    return {
      value: parseInt(current.value),
      classification: current.value_classification,
      timestamp: parseInt(current.timestamp) * 1000,
      history: entries.slice(1).map((e: any) => ({
        value: parseInt(e.value),
        classification: e.value_classification,
        timestamp: parseInt(e.timestamp) * 1000,
      })),
    };
  }

  // ─── CoinGecko: Market overview ───

  private async cg(endpoint: string, params: Record<string, string> = {}): Promise<unknown> {
    const qs = new URLSearchParams(params).toString();
    const url = `https://api.coingecko.com/api/v3${endpoint}${qs ? "?" + qs : ""}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.status === 429) throw new Error("CoinGecko rate limit. Try again in a minute.");
    if (!res.ok) throw new Error(`CoinGecko ${endpoint}: ${res.status}`);
    return res.json();
  }

  async getMarketOverview(): Promise<MarketOverview> {
    const data = await this.cg("/global") as any;
    const d = data.data;
    return {
      totalMarketCap: d.total_market_cap?.usd ?? 0,
      totalVolume24h: d.total_volume?.usd ?? 0,
      btcDominance: d.market_cap_percentage?.btc ?? 0,
      ethDominance: d.market_cap_percentage?.eth ?? 0,
      marketCapChangePct24h: d.market_cap_change_percentage_24h_usd ?? 0,
    };
  }

  async getTrending(): Promise<TrendingCoin[]> {
    const data = await this.cg("/search/trending") as any;
    return (data.coins ?? []).slice(0, 10).map((c: any) => {
      const item = c.item;
      return {
        id: item.id,
        symbol: (item.symbol ?? "").toUpperCase(),
        name: item.name,
        rank: item.market_cap_rank ?? 0,
        price: item.data?.price ?? 0,
        priceChangePct24h: item.data?.price_change_percentage_24h?.usd ?? 0,
        marketCap: parseFloat((item.data?.market_cap ?? "0").replace(/[^0-9.]/g, "")) || 0,
      };
    });
  }

  // ─── DefiLlama: TVL + Stablecoins ───

  private async dl(url: string): Promise<unknown> {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`DefiLlama: ${res.status}`);
    return res.json();
  }

  async getTotalTVL(): Promise<number> {
    const data = await this.dl("https://api.llama.fi/v2/historicalChainTvl") as any[];
    if (!data.length) return 0;
    return data[data.length - 1].tvl ?? 0;
  }

  async getTVLByChain(limit = 10): Promise<TVLData[]> {
    const data = await this.dl("https://api.llama.fi/v2/chains") as any[];
    return data
      .sort((a: any, b: any) => (b.tvl ?? 0) - (a.tvl ?? 0))
      .slice(0, limit)
      .map((c: any) => ({
        chain: c.name,
        tvl: c.tvl ?? 0,
        tvlChangePct1d: c.change_1d ?? 0,
        tvlChangePct7d: c.change_7d ?? 0,
      }));
  }

  async getStablecoins(): Promise<StablecoinData[]> {
    const data = await this.dl("https://stablecoins.llama.fi/stablecoins?includePrices=false") as any;
    return (data.peggedAssets ?? [])
      .sort((a: any, b: any) => (b.circulating?.peggedUSD ?? 0) - (a.circulating?.peggedUSD ?? 0))
      .slice(0, 10)
      .map((s: any) => {
        const supply = s.circulating?.peggedUSD ?? 0;
        const prevWeek = s.circulatingPrevWeek?.peggedUSD ?? supply;
        return {
          name: s.name,
          symbol: s.symbol,
          supply,
          supplyChangePct7d: prevWeek > 0 ? Math.round(((supply - prevWeek) / prevWeek) * 10000) / 100 : 0,
        };
      });
  }

  // ─── Composite overview ───

  async getOverview(): Promise<FullOverview> {
    const [fearGreed, market, trending, tvl, stables] = await Promise.allSettled([
      this.getFearGreed(),
      this.getMarketOverview(),
      this.getTrending(),
      this.getTotalTVL(),
      this.getStablecoins(),
    ]);

    return {
      fearGreed: fearGreed.status === "fulfilled" ? fearGreed.value : null,
      market: market.status === "fulfilled" ? market.value : null,
      trending: trending.status === "fulfilled" ? trending.value : [],
      totalTvl: tvl.status === "fulfilled" ? tvl.value : 0,
      stablecoinSupply: stables.status === "fulfilled"
        ? stables.value.reduce((sum, s) => sum + s.supply, 0) : 0,
    };
  }
}

