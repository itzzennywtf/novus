type CacheEntry = { ts: number; status: number; body: string };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 6 * 60 * 60 * 1000;

export default async function handler(req: any, res: any) {
  try {
    const symbol = String(req.query?.symbol || "").trim();
    const range = String(req.query?.range || "10y").trim();
    const interval = String(req.query?.interval || "1d").trim();
    if (!symbol) {
      res.status(400).json({ error: "Missing symbol" });
      return;
    }

    const key = `${symbol}|${range}|${interval}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts <= TTL_MS) {
      res.status(cached.status);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
      res.send(cached.body);
      return;
    }

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
    const upstream = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": req.headers?.["user-agent"] || "Mozilla/5.0",
        Referer: "https://finance.yahoo.com/",
      },
    });

    const text = await upstream.text();
    if (upstream.status === 429 && cached) {
      res.status(cached.status);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=86400");
      res.send(cached.body);
      return;
    }
    if (upstream.ok && text && text.length > 20) {
      cache.set(key, { ts: Date.now(), status: upstream.status, body: text });
    }
    res.status(upstream.status);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=86400");
    res.send(text);
  } catch (error: any) {
    res.status(502).json({ error: "Yahoo chart proxy failed", detail: String(error?.message || error) });
  }
}
