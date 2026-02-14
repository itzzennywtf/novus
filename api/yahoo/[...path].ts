const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-encoding",
  "content-length",
]);

const copyHeaders = (source: Headers, target: any) => {
  source.forEach((value, key) => {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) return;
    target.setHeader(key, value);
  });
};

export default async function handler(req: any, res: any) {
  try {
    const pathParts = Array.isArray(req.query?.path)
      ? req.query.path
      : req.query?.path
        ? [req.query.path]
        : [];
    const upstreamPath = `/${pathParts.join("/")}`;
    const url = new URL(`https://query1.finance.yahoo.com${upstreamPath}`);

    Object.entries(req.query || {}).forEach(([k, v]) => {
      if (k === "path") return;
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, String(item)));
      else if (v !== undefined) url.searchParams.set(k, String(v));
    });

    const upstream = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: req.headers?.accept || "application/json, text/plain, */*",
        "User-Agent": req.headers?.["user-agent"] || "Mozilla/5.0",
      },
    });

    res.status(upstream.status);
    copyHeaders(upstream.headers, res);
    const body = await upstream.arrayBuffer();
    res.send(Buffer.from(body));
  } catch (error: any) {
    res.status(502).json({
      error: "Yahoo proxy failed",
      detail: String(error?.message || error),
    });
  }
}

