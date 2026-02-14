export default async function handler(req: any, res: any) {
  try {
    const symbols = String(req.query?.symbols || "").trim();
    if (!symbols) {
      res.status(400).json({ error: "Missing symbols" });
      return;
    }

    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`;
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
    res.status(502).json({ error: "Yahoo quote proxy failed", detail: String(error?.message || error) });
  }
}

