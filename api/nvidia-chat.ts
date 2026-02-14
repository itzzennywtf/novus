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
    if (String(req.method || "").toUpperCase() !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const path = String(req.query?.path || "/chat/completions");
    const upstreamUrl = `https://integrate.api.nvidia.com/v1${path.startsWith("/") ? path : `/${path}`}`;
    const apiKey = process.env.NVIDIA_API_KEY || process.env.VITE_NVIDIA_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "Missing NVIDIA_API_KEY on server" });
      return;
    }

    const body = await readRawBody(req);
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    res.send(text);
  } catch (error: any) {
    res.status(502).json({ error: "NVIDIA proxy failed", detail: String(error?.message || error) });
  }
}

