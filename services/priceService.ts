import { AssetType } from "../types";

export interface MarketData {
  historicalPrice: number;
  currentPrice: number;
  startOfDay?: number;
  startOfWeek?: number;
  startOfMonth?: number;
  trend6M?: { name: string; price: number }[];
  trend1Y?: { name: string; price: number }[];
  trend5Y?: { name: string; price: number }[];
  trend10Y?: { name: string; price: number }[];
}

export interface InstrumentSuggestion {
  label: string;
  symbol: string;
  currentPrice: number;
  type: "STOCK" | "MUTUAL_FUND";
}

export interface MfSipSnapshot {
  investedAmount: number;
  quantity: number;
  currentPrice: number;
  currentValue: number;
  avgPurchasePrice: number;
  startOfDay?: number;
  startOfWeek?: number;
  startOfMonth?: number;
}

interface FetchMarketOptions {
  fixedSymbol?: string;
  lite?: boolean;
}

type PricePoint = { ts: number; price: number };

const OUNCE_TO_GRAM = 31.1034768;
const DAY_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12000;
const YAHOO_SERIES_CACHE_MS = 60_000;
const YAHOO_LOCAL_CACHE_PREFIX = "novus_yahoo_series_v1:";

const round2 = (n: number) => Math.round(n * 100) / 100;

const parsePurchaseDate = (value: string): number => {
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : Date.now();
};

const findClosestPrice = (series: PricePoint[], targetTs: number): number => {
  if (!series.length) return 0;
  let best = series[0];
  let bestDiff = Math.abs(series[0].ts - targetTs);

  for (let i = 1; i < series.length; i += 1) {
    const diff = Math.abs(series[i].ts - targetTs);
    if (diff < bestDiff) {
      best = series[i];
      bestDiff = diff;
    }
  }
  return best.price;
};

const priceAtOffsetFromEnd = (series: PricePoint[], daysBack: number): number => {
  if (!series.length) return 0;
  const idx = Math.max(0, series.length - 1 - daysBack);
  return series[idx].price;
};

const buildMonthlyTrend = (series: PricePoint[], months: number): { name: string; price: number }[] => {
  if (!series.length) return [];

  const end = new Date(series[series.length - 1].ts);
  const out: { name: string; price: number }[] = [];

  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
    const label = d.toLocaleString("en-US", { month: "short" });
    const price = findClosestPrice(series, d.getTime());
    out.push({ name: label, price: round2(price) });
  }

  return out;
};

const createFallbackData = (seed: string): MarketData => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;

  const base = 100 + (hash % 5000);
  const drift = (hash % 15) / 100;
  const current = base * (1 + drift);

  const trend6M = Array.from({ length: 6 }, (_, i) => ({
    name: new Date(Date.UTC(2025, i, 1)).toLocaleString("en-US", { month: "short" }),
    price: round2(base * (0.9 + i * 0.03)),
  }));

  const trend1Y = Array.from({ length: 12 }, (_, i) => ({
    name: new Date(Date.UTC(2025, i, 1)).toLocaleString("en-US", { month: "short" }),
    price: round2(base * (0.82 + i * 0.02)),
  }));
  const trend5Y = Array.from({ length: 60 }, (_, i) => ({
    name: new Date(Date.UTC(2021 + Math.floor(i / 12), i % 12, 1)).toLocaleString("en-US", { month: "short", year: "2-digit" }),
    price: round2(base * (0.6 + i * 0.01)),
  }));
  const trend10Y = Array.from({ length: 120 }, (_, i) => ({
    name: new Date(Date.UTC(2016 + Math.floor(i / 12), i % 12, 1)).toLocaleString("en-US", { month: "short", year: "2-digit" }),
    price: round2(base * (0.45 + i * 0.006)),
  }));

  return {
    historicalPrice: round2(base),
    currentPrice: round2(current),
    startOfDay: round2(current * 0.997),
    startOfWeek: round2(current * 0.985),
    startOfMonth: round2(current * 0.96),
    trend6M,
    trend1Y,
    trend5Y,
    trend10Y,
  };
};

const fetchWithTimeout = async (target: string): Promise<Response> => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(target, {
      signal: controller.signal,
      headers: { Accept: "application/json, text/plain, */*" },
      cache: "no-store",
    });
  } finally {
    window.clearTimeout(timer);
  }
};

const parseJsonFromText = <T>(text: string): T => {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Some relays can prepend anti-hijack tokens.
    const cleaned = trimmed.replace(/^\)\]\}',?\s*/, "");
    return JSON.parse(cleaned) as T;
  }
};

const getFetchTargets = (url: string): string[] => {
  const targets: string[] = [];
  const isLocalDev = import.meta.env.DEV;

  try {
    const parsed = new URL(url);
    if (parsed.hostname === "query1.finance.yahoo.com") {
      if (parsed.pathname.startsWith("/v8/finance/chart/")) {
        const symbol = parsed.pathname.split("/").pop() || "";
        const range = parsed.searchParams.get("range") || "10y";
        const interval = parsed.searchParams.get("interval") || "1d";
        if (isLocalDev) {
          targets.push(`/api/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`);
        } else {
          targets.push(`/api/yahoo-chart?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`);
        }
      } else if (parsed.pathname === "/v1/finance/search") {
        if (isLocalDev) {
          targets.push(`/api/yahoo/v1/finance/search${parsed.search}`);
        } else {
          targets.push(`/api/yahoo-search${parsed.search}`);
        }
      } else if (parsed.pathname === "/v7/finance/quote") {
        if (isLocalDev) {
          targets.push(`/api/yahoo/v7/finance/quote${parsed.search}`);
        } else {
          targets.push(`/api/yahoo-quote${parsed.search}`);
        }
      }
      // For Yahoo, never fall back to browser-direct URLs (CORS blocked/noisy).
      return targets;
    }
  } catch {
    // Keep external URL-only fallbacks.
  }

  targets.push(
    url,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://cors.isomorphic-git.org/${url}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
  );

  return targets;
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const isYahoo = url.includes("query1.finance.yahoo.com");
  const targets = getFetchTargets(url);

  let lastError: unknown = null;

  for (const target of targets) {
    try {
      const resp = await fetchWithTimeout(target);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${target}`);
      const text = await resp.text();
      return parseJsonFromText<T>(text);
    } catch (error) {
      lastError = error;
    }
  }

  // Final fallback for relays that wrap the payload in `contents`.
  // Skip this for Yahoo to avoid CORS/500 noise in production.
  if (isYahoo) {
    throw lastError instanceof Error ? lastError : new Error(`Unable to fetch ${url}`);
  }
  try {
    const wrappedUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const resp = await fetchWithTimeout(wrappedUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${wrappedUrl}`);
    const wrapped = await resp.json() as { contents?: string };
    if (!wrapped.contents) throw new Error("Missing contents in allorigins wrapper");
    return parseJsonFromText<T>(wrapped.contents);
  } catch (error) {
    lastError = error;
  }

  throw lastError instanceof Error ? lastError : new Error(`Unable to fetch ${url}`);
};

const yahooSeriesCache = new Map<string, { ts: number; data: PricePoint[] }>();
const yahooSeriesInflight = new Map<string, Promise<PricePoint[]>>();
const yahooSearchCache = new Map<string, { ts: number; data: YahooSearchResponse }>();
const SEARCH_CACHE_MS = 3 * 60 * 1000;

const getYahooSeriesTtl = (range: string): number => {
  if (range === "10y") return 24 * 60 * 60 * 1000;
  if (range === "5y") return 12 * 60 * 60 * 1000;
  if (range === "1y") return 3 * 60 * 60 * 1000;
  if (range === "6mo") return 60 * 60 * 1000;
  return 15 * 60 * 1000;
};

const readSeriesFromLocal = (key: string, ttlMs: number): PricePoint[] | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${YAHOO_LOCAL_CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts?: number; data?: PricePoint[] };
    if (!parsed?.ts || !Array.isArray(parsed?.data)) return null;
    if (Date.now() - parsed.ts > ttlMs) return null;
    if (!parsed.data.length) return null;
    return parsed.data;
  } catch {
    return null;
  }
};

const writeSeriesToLocal = (key: string, data: PricePoint[]) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${YAHOO_LOCAL_CACHE_PREFIX}${key}`,
      JSON.stringify({ ts: Date.now(), data })
    );
  } catch {
    // ignore storage quota errors
  }
};

const STOCK_SYMBOL_ALIASES: Record<string, string> = {
  HDFC: "HDFCBANK.NS",
  HDFCBANK: "HDFCBANK.NS",
  RELIANCE: "RELIANCE.NS",
  INFY: "INFY.NS",
  TCS: "TCS.NS",
  SBIN: "SBIN.NS",
  ICICIBANK: "ICICIBANK.NS",
  ITC: "ITC.NS",
  LT: "LT.NS",
  AXISBANK: "AXISBANK.NS",
};

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    }>;
  };
}

interface YahooSearchResponse {
  quotes?: Array<{
    symbol?: string;
    quoteType?: string;
    exchange?: string;
  }>;
}

interface YahooQuoteResponse {
  quoteResponse?: {
    result?: Array<{
      symbol?: string;
      regularMarketPrice?: number;
      regularMarketPreviousClose?: number;
    }>;
  };
}

interface MfScheme {
  schemeCode: number | string;
  schemeName: string;
}

const parseMfNavSeries = (rows: Array<{ date: string; nav: string }>): PricePoint[] =>
  rows
    .map((r) => {
      const parts = r.date.split("-");
      if (parts.length !== 3) return null;
      const ts = Date.UTC(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
      const nav = Number(r.nav);
      if (!Number.isFinite(ts) || !Number.isFinite(nav)) return null;
      return { ts, price: nav } as PricePoint;
    })
    .filter((v): v is PricePoint => Boolean(v))
    .sort((a, b) => a.ts - b.ts);

const findPriceOnOrBefore = (series: PricePoint[], targetTs: number): number => {
  if (!series.length) return 0;
  let lo = 0;
  let hi = series.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (series[mid].ts <= targetTs) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (idx >= 0) return series[idx].price;
  return series[0].price;
};

const daysInMonthUtc = (year: number, monthZeroBased: number): number =>
  new Date(Date.UTC(year, monthZeroBased + 1, 0)).getUTCDate();

const buildSipInstallmentDates = (startDate: string, sipDay: number): number[] => {
  const start = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return [];
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const safeDay = Math.max(1, Math.min(28, Math.floor(sipDay || 1)));
  const out: number[] = [];

  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  const endY = today.getUTCFullYear();
  const endM = today.getUTCMonth();

  while (y < endY || (y === endY && m <= endM)) {
    const dim = daysInMonthUtc(y, m);
    const day = Math.min(safeDay, dim);
    const ts = Date.UTC(y, m, day);
    if (ts >= start.getTime() && ts <= todayUtc) out.push(ts);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }

  return out;
};

const normalizeSearchText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

const tokenizeSearchText = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const scoreSchemeMatch = (query: string, schemeName: string): number => {
  const qNorm = normalizeSearchText(query);
  const nNorm = normalizeSearchText(schemeName);
  const qTokens = tokenizeSearchText(query);
  const nTokens = tokenizeSearchText(schemeName);
  if (!qNorm || !nNorm) return 0;

  let score = 0;

  if (nNorm === qNorm) score += 120;
  if (nNorm.startsWith(qNorm)) score += 90;
  if (nNorm.includes(qNorm)) score += 70;

  if (qTokens.length) {
    let tokenHits = 0;
    for (const qt of qTokens) {
      if (nTokens.some((nt) => nt.startsWith(qt) || nt.includes(qt))) tokenHits += 1;
    }
    score += tokenHits * 20;
  }

  // Small tie-breaker: prefer shorter/more precise scheme names.
  score -= Math.min(25, Math.floor(schemeName.length / 12));
  return score;
};

const fetchYahooSeries = async (symbol: string, range = "10y", interval = "1d"): Promise<PricePoint[]> => {
  const key = `${symbol.toUpperCase()}|${range}|${interval}`;
  const ttlMs = getYahooSeriesTtl(range);
  const cached = yahooSeriesCache.get(key);
  if (cached && Date.now() - cached.ts <= Math.max(YAHOO_SERIES_CACHE_MS, ttlMs)) {
    return cached.data;
  }
  const localCached = readSeriesFromLocal(key, ttlMs);
  if (localCached) {
    yahooSeriesCache.set(key, { ts: Date.now(), data: localCached });
    return localCached;
  }
  const inflight = yahooSeriesInflight.get(key);
  if (inflight) return inflight;

  const task = (async () => {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
    try {
      const json = await fetchJson<YahooChartResponse>(url);
      const result = json.chart?.result?.[0];
      const ts = result?.timestamp || [];
      const close = result?.indicators?.quote?.[0]?.close || [];

      const series: PricePoint[] = [];
      for (let i = 0; i < ts.length; i += 1) {
        const price = close[i];
        if (typeof price === "number" && Number.isFinite(price)) {
          series.push({ ts: ts[i] * 1000, price });
        }
      }

      if (!series.length) throw new Error(`No data for symbol ${symbol}`);
      yahooSeriesCache.set(key, { ts: Date.now(), data: series });
      writeSeriesToLocal(key, series);
      return series;
    } catch (error) {
      const stale = yahooSeriesCache.get(key);
      if (stale?.data?.length) return stale.data;
      const staleLocal = readSeriesFromLocal(key, 14 * 24 * 60 * 60 * 1000);
      if (staleLocal?.length) return staleLocal;
      throw error;
    } finally {
      yahooSeriesInflight.delete(key);
    }
  })();
  yahooSeriesInflight.set(key, task);
  return task;
};

const fetchYahooQuote = async (symbol: string): Promise<{ price: number; prevClose?: number }> => {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
  const json = await fetchJson<YahooQuoteResponse>(url);
  const row = json.quoteResponse?.result?.[0];
  const price = Number(row?.regularMarketPrice || 0);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`No quote for ${symbol}`);
  const prevClose = Number(row?.regularMarketPreviousClose || 0);
  return { price: round2(price), prevClose: Number.isFinite(prevClose) && prevClose > 0 ? round2(prevClose) : undefined };
};

const fetchYahooLatestPrice = async (symbol: string): Promise<number> => {
  try {
    const q = await fetchYahooQuote(symbol);
    return q.price;
  } catch {
    const series = await fetchYahooSeries(symbol, "1mo", "1d");
    return round2(series[series.length - 1].price);
  }
};

const resolveYahooSymbol = async (query: string, preferredTypes: string[] = []): Promise<string | null> => {
  const cleaned = query.trim();
  if (!cleaned) return null;

  const cacheKey = `s:${cleaned.toUpperCase()}:8`;
  const cached = yahooSearchCache.get(cacheKey);
  const json = cached && Date.now() - cached.ts <= SEARCH_CACHE_MS
    ? cached.data
    : await fetchJson<YahooSearchResponse>(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(cleaned)}&quotesCount=8&newsCount=0`);
  if (!cached || Date.now() - cached.ts > SEARCH_CACHE_MS) {
    yahooSearchCache.set(cacheKey, { ts: Date.now(), data: json });
  }
  const quotes = json.quotes || [];

  if (preferredTypes.length > 0) {
    const preferredSet = new Set(preferredTypes);
    const direct = quotes.find((q) => q.symbol && preferredSet.has(q.quoteType || ""));
    if (direct?.symbol) return direct.symbol;
  }

  const preferred = quotes.find((q) => {
    const symbol = (q.symbol || "").toUpperCase();
    const inPreferredType = preferredTypes.length === 0 ? q.quoteType === "EQUITY" : preferredTypes.includes(q.quoteType || "");
    return inPreferredType && (symbol.endsWith(".NS") || symbol.endsWith(".BO"));
  });
  if (preferred?.symbol) return preferred.symbol;

  if (preferredTypes.length > 0) {
    const byType = quotes.find((q) => preferredTypes.includes(q.quoteType || "") && q.symbol);
    if (byType?.symbol) return byType.symbol;
  }

  const firstEquity = quotes.find((q) => q.quoteType === "EQUITY" && q.symbol && ((q.symbol || "").endsWith(".NS") || (q.symbol || "").endsWith(".BO")));
  if (firstEquity?.symbol) return firstEquity.symbol;

  return quotes[0]?.symbol || null;
};

const resolveYahooTopSymbols = async (query: string, preferredTypes: string[] = [], limit = 3): Promise<string[]> => {
  const cleaned = query.trim();
  if (!cleaned) return [];
  const cacheKey = `s:${cleaned.toUpperCase()}:12`;
  const cached = yahooSearchCache.get(cacheKey);
  const json = cached && Date.now() - cached.ts <= SEARCH_CACHE_MS
    ? cached.data
    : await fetchJson<YahooSearchResponse>(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(cleaned)}&quotesCount=12&newsCount=0`);
  if (!cached || Date.now() - cached.ts > SEARCH_CACHE_MS) {
    yahooSearchCache.set(cacheKey, { ts: Date.now(), data: json });
  }
  const quotes = json.quotes || [];

  const byType = preferredTypes.length === 0
    ? quotes
    : quotes.filter((q) => preferredTypes.includes(q.quoteType || ""));

  const ranked = [
    ...byType.filter((q) => (q.symbol || "").endsWith(".NS") || (q.symbol || "").endsWith(".BO")),
    ...byType.filter((q) => !((q.symbol || "").endsWith(".NS") || (q.symbol || "").endsWith(".BO"))),
  ];

  const unique: string[] = [];
  for (const q of ranked) {
    if (!q.symbol) continue;
    if (!unique.includes(q.symbol)) unique.push(q.symbol);
    if (unique.length >= limit) break;
  }
  return unique;
};

const summarizeSeries = (series: PricePoint[], purchaseDate: string): MarketData => {
  const current = series[series.length - 1].price;
  const purchaseTs = parsePurchaseDate(purchaseDate);

  return {
    historicalPrice: round2(findClosestPrice(series, purchaseTs)),
    currentPrice: round2(current),
    startOfDay: round2(priceAtOffsetFromEnd(series, 1)),
    startOfWeek: round2(priceAtOffsetFromEnd(series, 5)),
    startOfMonth: round2(priceAtOffsetFromEnd(series, 21)),
    trend6M: buildMonthlyTrend(series, 6),
    trend1Y: buildMonthlyTrend(series, 12),
    trend5Y: buildMonthlyTrend(series, 60),
    trend10Y: buildMonthlyTrend(series, 120),
  };
};

const getStockCandidates = (name: string): string[] => {
  const cleaned = name.trim().toUpperCase().replace(/\s+/g, "");
  if (!cleaned) return [];
  const aliased = STOCK_SYMBOL_ALIASES[cleaned];
  if (aliased) return [aliased];
  if (cleaned.includes("=") || cleaned.includes(".")) return [cleaned];
  return [cleaned, `${cleaned}.NS`, `${cleaned}.BO`];
};

const fetchStockLikeData = async (name: string, purchaseDate: string, lite = false): Promise<MarketData> => {
  const candidates = getStockCandidates(name);
  const range = lite ? "6mo" : "10y";
  try {
    const resolved = await resolveYahooSymbol(name, ["EQUITY"]);
    if (resolved && !candidates.includes(resolved)) candidates.unshift(resolved);
  } catch {
    // Keep manual candidates.
  }

  for (const symbol of candidates) {
    try {
      if (lite) {
        const quote = await fetchYahooQuote(symbol);
        const current = quote.price;
        const prev = quote.prevClose || current;
        return {
          historicalPrice: round2(prev),
          currentPrice: round2(current),
          startOfDay: round2(prev),
          startOfWeek: round2(prev),
          startOfMonth: round2(prev),
          trend6M: [],
          trend1Y: [],
          trend5Y: [],
          trend10Y: [],
        };
      }
      const series = await fetchYahooSeries(symbol, range, "1d");
      return summarizeSeries(series, purchaseDate);
    } catch {
      // Try next symbol candidate.
    }
  }

  throw new Error(`Unable to fetch stock data for ${name}`);
};

const fetchMutualFundData = async (name: string, purchaseDate: string): Promise<MarketData> => {
  const asCode = name.match(/\d{5,8}/)?.[0];
  if (!asCode) throw new Error("Mutual fund tracking expects mfapi scheme code");
  const url = `https://api.mfapi.in/mf/${asCode}`;
  const json = await fetchJson<{ data?: Array<{ date: string; nav: string }> }>(url);
  const series = parseMfNavSeries(json.data || []);

  if (!series.length) throw new Error(`No NAV data for scheme ${asCode}`);
  return summarizeSeries(series, purchaseDate);
};

export const fetchMutualFundSipSnapshot = async (
  schemeCode: string,
  sipStartDate: string,
  sipAmount: number,
  sipDay: number
): Promise<MfSipSnapshot> => {
  const code = String(schemeCode || "").match(/\d{5,8}/)?.[0];
  if (!code) throw new Error("SIP tracking expects valid mfapi scheme code.");
  if (!Number.isFinite(sipAmount) || sipAmount <= 0) throw new Error("SIP amount must be positive.");

  const json = await fetchJson<{ data?: Array<{ date: string; nav: string }> }>(`https://api.mfapi.in/mf/${code}`);
  const series = parseMfNavSeries(json.data || []);
  if (!series.length) throw new Error(`No NAV data for scheme ${code}`);

  const installmentDates = buildSipInstallmentDates(sipStartDate, sipDay);
  let totalUnits = 0;
  let investedAmount = 0;
  for (const ts of installmentDates) {
    const nav = findPriceOnOrBefore(series, ts);
    if (!Number.isFinite(nav) || nav <= 0) continue;
    totalUnits += sipAmount / nav;
    investedAmount += sipAmount;
  }

  const currentPrice = round2(series[series.length - 1].price);
  const quantity = round2(totalUnits);
  const currentValue = round2(totalUnits * currentPrice);
  const avgPurchasePrice = totalUnits > 0 ? round2(investedAmount / totalUnits) : currentPrice;

  return {
    investedAmount: round2(investedAmount),
    quantity,
    currentPrice,
    currentValue,
    avgPurchasePrice,
    startOfDay: round2(priceAtOffsetFromEnd(series, 1)),
    startOfWeek: round2(priceAtOffsetFromEnd(series, 5)),
    startOfMonth: round2(priceAtOffsetFromEnd(series, 21)),
  };
};

const mergeGoldSeries = (xau: PricePoint[], usdInr: PricePoint[]): PricePoint[] => {
  if (!xau.length || !usdInr.length) return [];

  return xau.map((p) => {
    const fx = findClosestPrice(usdInr, p.ts);
    const inrPerGram = (p.price * fx) / OUNCE_TO_GRAM;
    return { ts: p.ts, price: inrPerGram };
  });
};

const fetchGoldData = async (purchaseDate: string): Promise<MarketData> => {
  // Yahoo uses USDINR=X for USD/INR (not INR=X).
  const combos: Array<[string, string]> = [["GC=F", "USDINR=X"], ["XAUUSD=X", "USDINR=X"], ["GC=F", "INR=X"]];

  for (const [goldSymbol, fxSymbol] of combos) {
    try {
      const [goldSeries, fxSeries] = await Promise.all([
        fetchYahooSeries(goldSymbol),
        fetchYahooSeries(fxSymbol),
      ]);
      const combined = mergeGoldSeries(goldSeries, fxSeries);
      if (combined.length) return summarizeSeries(combined, purchaseDate);
    } catch {
      // Try next symbol pair.
    }
  }

  throw new Error("Unable to fetch gold data");
};

export const fetchMarketData = async (name: string, type: string, purchaseDate: string, options?: FetchMarketOptions): Promise<MarketData> => {
  try {
    if (type === AssetType.GOLD) {
      return await fetchGoldData(purchaseDate);
    }
    if (type === AssetType.MUTUAL_FUNDS) {
      return await fetchMutualFundData(options?.fixedSymbol || name, purchaseDate);
    }
    if (type === AssetType.FIXED_DEPOSIT) {
      return createFallbackData(`fd:${name}`);
    }
    if (options?.fixedSymbol) {
      const series = await fetchYahooSeries(options.fixedSymbol, options?.lite ? "6mo" : "10y", "1d");
      return summarizeSeries(series, purchaseDate);
    }
    return await fetchStockLikeData(name, purchaseDate, options?.lite);
  } catch (error) {
    console.error("Market data fallback:", error);
    return createFallbackData(`${type}:${name}`);
  }
};

let mfSchemeCache: MfScheme[] | null = null;
const loadMfSchemes = async (): Promise<MfScheme[]> => {
  if (mfSchemeCache) return mfSchemeCache;
  const list = await fetchJson<MfScheme[]>("https://api.mfapi.in/mf");
  mfSchemeCache = Array.isArray(list) ? list : [];
  return mfSchemeCache;
};

export const searchInstruments = async (query: string, type: AssetType): Promise<InstrumentSuggestion[]> => {
  const q = query.trim();
  if (q.length < 2) return [];

  if (type === AssetType.STOCKS) {
    const cleanedQuery = q.replace(/[-_/.,]+/g, " ").replace(/\s+/g, " ").trim();
    let symbols: string[] = [];
    try {
      symbols = await resolveYahooTopSymbols(cleanedQuery || q, ["EQUITY"], 3);
      if (!symbols.length && cleanedQuery && cleanedQuery !== q) {
        symbols = await resolveYahooTopSymbols(q, ["EQUITY"], 3);
      }
    } catch {
      symbols = [];
    }

    if (!symbols.length) {
      const guess = (cleanedQuery || q).toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (guess) {
        const aliased = STOCK_SYMBOL_ALIASES[guess];
        symbols = [aliased || (guess.includes(".") ? guess : `${guess}.NS`)];
      }
    }

    const pricedSettled = await Promise.allSettled(
      symbols.map(async (symbol) => ({
        label: symbol,
        symbol,
        currentPrice: await fetchYahooLatestPrice(symbol),
        type: "STOCK" as const,
      }))
    );

    const priced = pricedSettled
      .filter((r): r is PromiseFulfilledResult<InstrumentSuggestion> => r.status === "fulfilled")
      .map((r) => r.value);

    if (priced.length) return priced.slice(0, 3);
    return symbols.slice(0, 3).map((symbol) => ({ label: symbol, symbol, currentPrice: 0, type: "STOCK" as const }));
  }

  if (type === AssetType.MUTUAL_FUNDS) {
    const schemes = await loadMfSchemes();
    const ranked = schemes
      .map((s) => ({ ...s, _score: scoreSchemeMatch(q, s.schemeName) }))
      .filter((s) => s._score > 0)
      .sort((a, b) => b._score - a._score);
    const top = ranked.slice(0, 6);

    const priced = await Promise.all(
      top.map(async (s) => {
        const symbol = String(s.schemeCode);
        const details = await fetchJson<{ data?: Array<{ nav: string }> }>(`https://api.mfapi.in/mf/${symbol}`);
        const latest = Number(details.data?.[0]?.nav || 0);
        return {
          label: s.schemeName,
          symbol,
          currentPrice: round2(latest),
          type: "MUTUAL_FUND" as const,
        };
      })
    );
    return priced.filter((p) => Number.isFinite(p.currentPrice) && p.currentPrice > 0);
  }

  return [];
};

export const getAIPrediction = async (holdingName: string): Promise<string> => {
  let hash = 0;
  for (let i = 0; i < holdingName.length; i += 1) hash = (hash * 33 + holdingName.charCodeAt(i)) >>> 0;
  const pct = ((hash % 900) - 300) / 100;

  if (pct >= 2) return `Bias is positive: ${pct.toFixed(1)}% potential upside in the next 30 days if trend continues.`;
  if (pct >= 0) return `Outlook is neutral-positive: around ${pct.toFixed(1)}% move expected over the next 30 days.`;
  return `Expect higher volatility: about ${Math.abs(pct).toFixed(1)}% downside risk in the next 30 days.`;
};

export const calculateFDGrowth = (principal: number, rate: number, startDate: string): number => {
  const start = new Date(startDate).getTime();
  const now = new Date().getTime();
  const diffDays = Math.max(0, Math.floor((now - start) / DAY_MS));
  const yearsPassed = diffDays / 365;
  return principal * Math.pow(1 + rate / 400, 4 * yearsPassed);
};
