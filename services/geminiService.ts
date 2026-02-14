import { Investment, AssetType } from "../types";

type MarketHeadline = {
  title: string;
  source: string;
  url?: string;
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AssistantChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type LlmRiskCategory = {
  type: AssetType;
  label: string;
  value: number;
  share: number;
  score: number;
  level: "Low" | "Moderate" | "Moderate High" | "High";
};

export type LlmRiskProfile = {
  score: number;
  label: "Low" | "Moderate Low" | "Moderate" | "Moderate High" | "High" | "No Data";
  note: string;
  categoryBreakdown: LlmRiskCategory[];
  factors: string[];
};

type NemotronResponse = {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

type NemotronStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
    finish_reason?: string | null;
  }>;
};

const MODEL = "nvidia/nemotron-3-nano-30b-a3b";
const BASE_URLS = ["/api/nvidia-chat"];
const API_KEY = import.meta.env.VITE_NVIDIA_API_KEY as string | undefined;
const MAX_RESPONSE_TOKENS = 1024;
const LLM_RETRIES = 3;

const toErrorString = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const formatRs = (value: number): string => {
  const rounded = Math.round(Math.abs(value));
  return `Rs ${rounded.toLocaleString("en-IN")}`;
};

const getTypeLabel = (type: AssetType): string => {
  switch (type) {
    case AssetType.STOCKS:
      return "stocks";
    case AssetType.MUTUAL_FUNDS:
      return "mutual funds";
    case AssetType.GOLD:
      return "gold";
    case AssetType.FIXED_DEPOSIT:
      return "FDs";
    default:
      return "assets";
  }
};

const buildPortfolioSnapshot = (portfolio: Investment[]) => {
  const totals = portfolio.reduce(
    (acc, item) => {
      acc.invested += item.investedAmount;
      acc.current += item.currentValue;
      acc.byType[item.type] = (acc.byType[item.type] || 0) + item.currentValue;
      return acc;
    },
    { invested: 0, current: 0, byType: {} as Record<string, number> }
  );

  const gain = totals.current - totals.invested;
  const gainPct = totals.invested > 0 ? (gain / totals.invested) * 100 : 0;

  const holdings = portfolio
    .map((h) => ({
      name: h.name,
      type: h.type,
      invested: h.investedAmount,
      current: h.currentValue,
      pnl: h.currentValue - h.investedAmount,
      pnlPct: h.investedAmount > 0 ? ((h.currentValue - h.investedAmount) / h.investedAmount) * 100 : 0,
      purchaseDate: h.purchaseDate,
      symbol: h.trackingSymbol || "",
    }))
    .sort((a, b) => b.current - a.current);

  const allocation = Object.values(AssetType)
    .map((type) => {
      const value = totals.byType[type] || 0;
      const share = totals.current > 0 ? (value / totals.current) * 100 : 0;
      return { type, label: getTypeLabel(type), value, share };
    })
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);

  return {
    invested: totals.invested,
    current: totals.current,
    gain,
    gainPct,
    allocation,
    holdings,
  };
};

const extractContent = (json: NemotronResponse): string | null => {
  const choice = json.choices?.[0];
  const message = choice?.message;
  let content = message?.content;

  if (typeof content === "string" && content.trim()) return content.trim();

  if (Array.isArray(content)) {
    const text = content
      .filter((p) => p && p.type === "text")
      .map((p) => p.text || "")
      .join("")
      .trim();
    if (text) return text;
  }

  return null;
};

const parseFirstJsonObject = (text: string): Record<string, unknown> | null => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const sanitizeRiskLevel = (level: string): "Low" | "Moderate" | "Moderate High" | "High" => {
  const v = level.toLowerCase();
  if (v.includes("high") && v.includes("moderate")) return "Moderate High";
  if (v.includes("high")) return "High";
  if (v.includes("moderate")) return "Moderate";
  return "Low";
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const postNemotron = async (
  path: string,
  payload: Record<string, unknown>
): Promise<Response> => {
  const endpointErrors: string[] = [];

  for (const baseUrl of BASE_URLS) {
    try {
      const target = baseUrl === "/api/nvidia-chat"
        ? `${baseUrl}?path=${encodeURIComponent(path)}`
        : `${baseUrl}${path}`;
      const resp = await fetch(target, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Nemotron API error ${resp.status}: ${text}`);
      }
      return resp;
    } catch (error) {
      endpointErrors.push(`${baseUrl}${path} -> ${toErrorString(error)}`);
    }
  }

  throw new Error(`Nemotron request failed on all endpoints. ${endpointErrors.join(" | ")}`);
};

const runNemotron = async (messages: ChatMessage[]): Promise<string> => {
  if (!API_KEY) {
    throw new Error("Missing VITE_NVIDIA_API_KEY");
  }

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= LLM_RETRIES; attempt += 1) {
    try {
      const resp = await postNemotron("/chat/completions", {
        model: MODEL,
        messages,
        temperature: 0.25,
        top_p: 0.9,
        max_tokens: MAX_RESPONSE_TOKENS,
      });

      const json = (await resp.json()) as NemotronResponse;
      const content = extractContent(json);
      if (!content) throw new Error("Nemotron returned empty content.");
      return content;
    } catch (error) {
      lastError = error;
      if (attempt < LLM_RETRIES) await sleep(300 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Nemotron request failed");
};

const parseDeltaContent = (chunk: NemotronStreamChunk): string => {
  const content = chunk.choices?.[0]?.delta?.content;
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && p.type === "text")
      .map((p) => p.text || "")
      .join("");
  }
  return "";
};

const runNemotronStream = async (messages: ChatMessage[], onDelta: (delta: string) => void): Promise<string> => {
  if (!API_KEY) throw new Error("Missing VITE_NVIDIA_API_KEY");

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= LLM_RETRIES; attempt += 1) {
    try {
      const resp = await postNemotron("/chat/completions", {
      model: MODEL,
      messages,
      temperature: 0.25,
      top_p: 0.9,
      max_tokens: MAX_RESPONSE_TOKENS,
      stream: true,
      });

      if (!resp.body) throw new Error("Nemotron stream has no body.");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const chunk = JSON.parse(payload) as NemotronStreamChunk;
            const delta = parseDeltaContent(chunk);
            if (!delta) continue;
            full += delta;
            onDelta(delta);
          } catch {
            // Ignore malformed stream chunks.
          }
        }
      }

      if (!full.trim()) throw new Error("Nemotron stream returned empty content.");
      return full.trim();
    } catch (error) {
      lastError = error;
      if (attempt < LLM_RETRIES) await sleep(300 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Nemotron stream failed");
};

const buildSystemPrompt = (): string => {
  return [
    "You are Novus AI, a practical personal finance copilot for Indian retail investors.",
    "Use only provided portfolio context and user prompt.",
    "Always reply in Hindi (Devanagari script).",
    "Style: concise, clear, supportive, non-judgmental.",
    "Answer only what user asked. Do not add extra sections unless requested.",
    "Keep default response short: 2-5 lines, max ~90 words.",
    "Always include numbers when possible.",
    "If asked future estimate, provide safe and optimistic scenarios with assumptions.",
    "If asked goal planning, provide monthly SIP needed and success confidence.",
    "If asked affordability, compare amount vs portfolio and monthly investing pace.",
    "For follow-up prompts like 'its details', use chat history context to resolve what 'its' refers to.",
    "When user asks best stock/mutual fund, return exact name + invested + current + return%.",
    "Never claim guaranteed returns.",
    "If user asks for detail, still keep under 160 words.",
    "If user asks for market news, say live news feed is disabled and continue with portfolio-only guidance in Hindi.",
  ].join("\n");
};

const buildAssistantMessages = async (
  portfolio: Investment[],
  prompt: string,
  history: AssistantChatTurn[] = []
): Promise<ChatMessage[]> => {
  const snapshot = buildPortfolioSnapshot(portfolio);
  const monthlyInvestEstimate = snapshot.invested / Math.max(1, portfolio.length * 3);
  const context = {
    totals: {
      current: snapshot.current,
      invested: snapshot.invested,
      gain: snapshot.gain,
      gainPct: snapshot.gainPct,
    },
    monthlyInvestEstimate,
    allocation: snapshot.allocation,
    holdings: snapshot.holdings.slice(0, 12),
  };

  const system = buildSystemPrompt();
  const trimmedHistory = history
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content?.trim())
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.trim() })) as ChatMessage[];
  const user = [
    `User question: ${prompt}`,
    "Portfolio context (JSON):",
    JSON.stringify(context),
    "Answer with actionable guidance grounded in this data.",
    "If the question asks for affordability/goal/future, show calculations and assumptions.",
  ].join("\n");

  return [{ role: "system", content: system }, ...trimmedHistory, { role: "user", content: user }];
};

const fallbackInsight = (portfolio: Investment[], assetType?: AssetType) => {
  const filtered = assetType ? portfolio.filter((i) => i.type === assetType) : portfolio;
  if (!filtered.length) return "अभी कोई होल्डिंग रिकॉर्ड नहीं है। ट्रैकिंग शुरू करने के लिए अपना पहला एसेट जोड़ें।";
  const snapshot = buildPortfolioSnapshot(filtered);
  return `पोर्टफोलियो वैल्यू ${formatRs(snapshot.current)} है, जबकि निवेश ${formatRs(snapshot.invested)} है (${snapshot.gain >= 0 ? "+" : "-"}${Math.abs(snapshot.gainPct).toFixed(1)}%).`;
};

export async function getAssetSpecificInsights(portfolio: Investment[], assetType?: AssetType) {
  const filtered = assetType ? portfolio.filter((i) => i.type === assetType) : portfolio;
  if (!filtered.length) return fallbackInsight(filtered, assetType);

  try {
    const snapshot = buildPortfolioSnapshot(filtered);
    const system = buildSystemPrompt();
    const user = [
      `Generate an insight summary for ${assetType ? getTypeLabel(assetType) : "full portfolio"}.`,
      `Totals: current ${formatRs(snapshot.current)}, invested ${formatRs(snapshot.invested)}, gain ${formatRs(snapshot.gain)} (${snapshot.gainPct.toFixed(1)}%).`,
      `Allocation: ${snapshot.allocation.map((a) => `${a.label} ${a.share.toFixed(0)}%`).join(", ")}.`,
      `Top holdings: ${snapshot.holdings.slice(0, 4).map((h) => `${h.name} (${h.pnlPct.toFixed(1)}%)`).join(", ")}.`,
      "Give: current health, biggest risk, and next action.",
    ].join("\n");
    return await runNemotron([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
  } catch {
    return fallbackInsight(filtered, assetType);
  }
}

export async function getHoldingPredictionFromLLM(holding: Investment): Promise<string> {
  const system = [
    "You are Novus AI, a practical investing assistant.",
    "Always reply in Hindi (Devanagari).",
    "Give a concise 30-day directional prediction with reason and risk.",
    "Keep answer under 45 words.",
    "No markdown, no bullets.",
    "No guarantees.",
  ].join("\n");

  const user = [
    "Holding context:",
    JSON.stringify({
      name: holding.name,
      type: holding.type,
      invested: holding.investedAmount,
      current: holding.currentValue,
      pnl: holding.currentValue - holding.investedAmount,
      pnlPct: holding.investedAmount > 0 ? ((holding.currentValue - holding.investedAmount) / holding.investedAmount) * 100 : 0,
      purchaseDate: holding.purchaseDate,
      symbol: holding.trackingSymbol || holding.displaySymbol || "",
    }),
    "Respond with one short prediction sentence.",
  ].join("\n");

  return runNemotron([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
}

export async function getPortfolioRiskFromLLM(portfolio: Investment[]): Promise<LlmRiskProfile> {
  const snapshot = buildPortfolioSnapshot(portfolio);
  const system = [
    "You are Novus AI risk engine.",
    "Return ONLY valid JSON with keys: score,label,note,categoryBreakdown,factors.",
    "score must be 0-100 number.",
    "label must be one of: Low, Moderate Low, Moderate, Moderate High, High, No Data.",
    "categoryBreakdown must include STOCKS, MUTUAL_FUNDS, GOLD, FIXED_DEPOSIT.",
    "Each category item: type,label,value,share,score,level.",
    "level must be one of: Low, Moderate, Moderate High, High.",
    "No markdown and no extra text.",
  ].join("\n");

  const user = [
    "Portfolio snapshot JSON:",
    JSON.stringify({
      totals: {
        invested: snapshot.invested,
        current: snapshot.current,
        gain: snapshot.gain,
        gainPct: snapshot.gainPct,
      },
      allocation: snapshot.allocation,
      holdings: snapshot.holdings.slice(0, 20),
    }),
  ].join("\n");

  const raw = await runNemotron([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);

  const obj = parseFirstJsonObject(raw);
  if (!obj) throw new Error("Invalid JSON from LLM risk response.");

  const score = Number(obj.score);
  const label = String(obj.label || "Moderate");
  const note = String(obj.note || "");
  const factors = Array.isArray(obj.factors) ? obj.factors.map((f) => String(f)).slice(0, 6) : [];
  const categoryRaw = Array.isArray(obj.categoryBreakdown) ? obj.categoryBreakdown : [];

  const categoryBreakdown: LlmRiskCategory[] = categoryRaw
    .map((c) => {
      const type = String((c as Record<string, unknown>).type || "").toUpperCase() as AssetType;
      if (!Object.values(AssetType).includes(type)) return null;
      return {
        type,
        label: String((c as Record<string, unknown>).label || getTypeLabel(type)),
        value: Number((c as Record<string, unknown>).value || 0),
        share: Number((c as Record<string, unknown>).share || 0),
        score: Math.max(0, Math.min(100, Number((c as Record<string, unknown>).score || 0))),
        level: sanitizeRiskLevel(String((c as Record<string, unknown>).level || "Moderate")),
      } as LlmRiskCategory;
    })
    .filter((c): c is LlmRiskCategory => Boolean(c));

  return {
    score: Math.max(0, Math.min(100, Number.isFinite(score) ? score : 50)),
    label: (["Low", "Moderate Low", "Moderate", "Moderate High", "High", "No Data"].includes(label)
      ? label
      : "Moderate") as LlmRiskProfile["label"],
    note: note || "Risk profile generated from your portfolio allocation and concentration.",
    categoryBreakdown,
    factors,
  };
}

export async function getPortfolioAssistantReply(
  portfolio: Investment[],
  prompt: string,
  history: AssistantChatTurn[] = []
): Promise<string> {
  if (!portfolio.length) {
    return "अभी पोर्टफोलियो डेटा नहीं है। पहले होल्डिंग जोड़ें, फिर सुझाव, जोखिम, एसेट एलोकेशन या गोल प्लानिंग पूछें।";
  }

  const snapshot = buildPortfolioSnapshot(portfolio);

  try {
    const messages = await buildAssistantMessages(portfolio, prompt, history);
    return await runNemotron(messages);
  } catch (error) {
    const reason = toErrorString(error);
    console.error("AI chat failure:", reason);
    return `AI सेवा अभी उपलब्ध नहीं है। कारण: ${reason}। पोर्टफोलियो स्नैपशॉट: current ${formatRs(snapshot.current)}, invested ${formatRs(snapshot.invested)}।`;
  }
}

export async function streamPortfolioAssistantReply(
  portfolio: Investment[],
  prompt: string,
  onDelta: (delta: string) => void,
  history: AssistantChatTurn[] = []
): Promise<string> {
  if (!portfolio.length) {
    const text = "अभी पोर्टफोलियो डेटा नहीं है। पहले होल्डिंग जोड़ें, फिर सुझाव, जोखिम, एसेट एलोकेशन या गोल प्लानिंग पूछें।";
    onDelta(text);
    return text;
  }

  const snapshot = buildPortfolioSnapshot(portfolio);
  let messages: ChatMessage[] = [];
  try {
    messages = await buildAssistantMessages(portfolio, prompt, history);
    const streamed = await runNemotronStream(messages, onDelta);
    if (streamed) return streamed;
    throw new Error("Empty stream content");
  } catch (streamError) {
    try {
      if (!messages.length) messages = await buildAssistantMessages(portfolio, prompt, history);
      const nonStream = await runNemotron(messages);
      onDelta(nonStream);
      return nonStream;
    } catch (nonStreamError) {
      const reason = `${toErrorString(streamError)} | fallback: ${toErrorString(nonStreamError)}`;
      console.error("AI stream failure:", reason);
      const fallback = `AI सेवा अभी उपलब्ध नहीं है। कारण: ${reason}। पोर्टफोलियो स्नैपशॉट: current ${formatRs(snapshot.current)}, invested ${formatRs(snapshot.invested)}।`;
      onDelta(fallback);
      return fallback;
    }
  }
}
