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

const readRawBody = async (req: any): Promise<string> => {
  if (typeof req.body === "string") return req.body;
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);

  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
};

export default async function handler(req: any, res: any) {
  try {
    const method = String(req.method || "GET").toUpperCase();
    if (method !== "POST" && method !== "GET") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const pathParts = Array.isArray(req.query?.path)
      ? req.query.path
      : req.query?.path
        ? [req.query.path]
        : [];
    const upstreamPath = `/${pathParts.join("/")}`;
    const url = new URL(`https://integrate.api.nvidia.com${upstreamPath}`);

    Object.entries(req.query || {}).forEach(([k, v]) => {
      if (k === "path") return;
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, String(item)));
      else if (v !== undefined) url.searchParams.set(k, String(v));
    });

    const envKey = process.env.NVIDIA_API_KEY || process.env.VITE_NVIDIA_API_KEY;
    const incomingAuth = req.headers?.authorization;
    const authHeader = incomingAuth || (envKey ? `Bearer ${envKey}` : "");
    if (!authHeader) {
      res.status(500).json({ error: "Missing NVIDIA API key on server." });
      return;
    }

    const body = method === "POST" ? await readRawBody(req) : undefined;
    const upstream = await fetch(url.toString(), {
      method,
      headers: {
        Accept: req.headers?.accept || "application/json",
        "Content-Type": req.headers?.["content-type"] || "application/json",
        Authorization: authHeader,
      },
      body,
    });

    res.status(upstream.status);
    copyHeaders(upstream.headers, res);
    const responseBody = await upstream.arrayBuffer();
    res.send(Buffer.from(responseBody));
  } catch (error: any) {
    res.status(502).json({
      error: "NVIDIA proxy failed",
      detail: String(error?.message || error),
    });
  }
}

