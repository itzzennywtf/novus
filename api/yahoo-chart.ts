export default async function handler(req: any, res: any) {
  try {
    const symbol = String(req.query?.symbol || "").trim();
    const range = String(req.query?.range || "10y").trim();
    const interval = String(req.query?.interval || "1d").trim();
    if (!symbol) {
      res.status(400).json({ error: "Missing symbol" });
      return;
    }

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
    const upstream = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": req.headers?.["user-agent"] || "Mozilla/5.0",
      },
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.send(text);
  } catch (error: any) {
    res.status(502).json({ error: "Yahoo chart proxy failed", detail: String(error?.message || error) });
  }
}

