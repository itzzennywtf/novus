type CacheEntry = { ts: number; status: number; body: string };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60 * 1000;

export default async function handler(req: any, res: any) {
  try {
    const symbols = String(req.query?.symbols || "").trim();
    if (!symbols) {
      res.status(400).json({ error: "Missing symbols" });
      return;
    }

    const key = symbols.toUpperCase();
    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts <= TTL_MS) {
      res.status(cached.status);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=600");
      res.send(cached.body);
      return;
    }

    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`;
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
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=600");
    res.send(text);
  } catch (error: any) {
    res.status(502).json({ error: "Yahoo quote proxy failed", detail: String(error?.message || error) });
  }
}
