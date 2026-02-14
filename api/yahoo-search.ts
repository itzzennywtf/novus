export default async function handler(req: any, res: any) {
  try {
    const q = String(req.query?.q || "").trim();
    const quotesCount = String(req.query?.quotesCount || "8").trim();
    const newsCount = String(req.query?.newsCount || "0").trim();
    if (!q) {
      res.status(400).json({ error: "Missing q" });
      return;
    }

    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=${encodeURIComponent(quotesCount)}&newsCount=${encodeURIComponent(newsCount)}`;
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
    res.status(502).json({ error: "Yahoo search proxy failed", detail: String(error?.message || error) });
  }
}

