type CacheEntry = { ts: number; status: number; body: string };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 24 * 60 * 60 * 1000;

export default async function handler(req: any, res: any) {
  try {
    const q = String(req.query?.q || "").trim();
    const quotesCount = String(req.query?.quotesCount || "8").trim();
    const newsCount = String(req.query?.newsCount || "0").trim();
    if (!q) {
      res.status(400).json({ error: "Missing q" });
      return;
    }

    const key = `${q.toUpperCase()}|${quotesCount}|${newsCount}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts <= TTL_MS) {
      res.status(cached.status);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
      res.send(cached.body);
      return;
    }

    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=${encodeURIComponent(quotesCount)}&newsCount=${encodeURIComponent(newsCount)}`;
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
      res.send(cached.body);
      return;
    }
    if (upstream.ok && text && text.length > 20) {
      cache.set(key, { ts: Date.now(), status: upstream.status, body: text });
    }
    res.status(upstream.status);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
    res.send(text);
  } catch (error: any) {
    res.status(502).json({ error: "Yahoo search proxy failed", detail: String(error?.message || error) });
  }
}
