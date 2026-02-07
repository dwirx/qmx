export const DEFAULT_OLLAMA_HOST = "http://172.20.32.1:11434";
export const DEFAULT_EMBED_MODEL = "nomic-embed-text";
export const DEFAULT_EXPANDER_MODEL = "hf.co/tobil/qmd-query-expansion-1.7B-gguf:Q4_K_M";
export const DEFAULT_RERANKER_MODEL = "fanyx/Qwen3-Reranker-0.6B-Q8_0:latest";
const DEFAULT_TIMEOUT_MS = 5000;

export function resolveOllamaHost(host?: string, fallback?: string): string {
  const raw = (host || process.env.OLLAMA_HOST || fallback || DEFAULT_OLLAMA_HOST).trim();
  const withScheme = /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/$/, "");
}

function ollamaTimeoutMs(): number {
  const raw = Number(process.env.QMX_OLLAMA_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.floor(raw);
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const timeoutMs = ollamaTimeoutMs();
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const msg = String(error);
    if (msg.includes("AbortError") || msg.includes("aborted")) {
      throw new Error(`Ollama request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

export async function embedText(text: string, host?: string, model = DEFAULT_EMBED_MODEL): Promise<number[]> {
  const base = resolveOllamaHost(host);
  const body = { model, prompt: text };

  const resp = await fetchWithTimeout(`${base}/api/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (resp.ok) {
    const data = (await resp.json()) as { embedding?: number[] };
    if (Array.isArray(data.embedding)) return data.embedding;
  }

  const fallback = await fetchWithTimeout(`${base}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, input: text }),
  });

  if (!fallback.ok) {
    const detail = await fallback.text();
    throw new Error(`Ollama embed failed: ${fallback.status} ${detail}`);
  }

  const data = (await fallback.json()) as { embeddings?: number[][] };
  const first = data.embeddings?.[0];
  if (!first) throw new Error("Ollama embed response missing vector");
  return first;
}

export async function expandQuery(query: string, host?: string, model = DEFAULT_EXPANDER_MODEL): Promise<string[]> {
  const base = resolveOllamaHost(host);
  const prompt = `You generate concise search query variations.\nReturn ONLY a JSON array of 2 strings.\nOriginal query: ${query}`;
  const resp = await fetchWithTimeout(`${base}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false }),
  });
  if (!resp.ok) return [];
  const data = (await resp.json()) as { response?: string };
  const raw = (data.response || "").trim();

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((v) => String(v).trim())
        .filter(Boolean)
        .slice(0, 2);
    }
  } catch {
    // fall through
  }

  const lines = raw
    .split("\n")
    .map((v) => v.replace(/^[\-\d\.\)\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 2);
  return lines;
}

export async function rerankDocuments(
  query: string,
  docs: Array<{ docid: string; title: string; snippet: string }>,
  host?: string,
  model = DEFAULT_RERANKER_MODEL
): Promise<Map<string, number>> {
  const base = resolveOllamaHost(host);
  const out = new Map<string, number>();

  for (const doc of docs) {
    const prompt = [
      "Rate relevance from 0 to 10.",
      "Return ONLY one number.",
      `Query: ${query}`,
      `Title: ${doc.title}`,
      `Snippet: ${doc.snippet}`,
    ].join("\n");

    const resp = await fetchWithTimeout(`${base}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
    });
    if (!resp.ok) continue;
    const data = (await resp.json()) as { response?: string };
    const text = (data.response || "").trim();
    const m = text.match(/-?\d+(\.\d+)?/);
    if (!m) continue;
    const n = Number(m[0]);
    if (!Number.isFinite(n)) continue;
    const score = Math.max(0, Math.min(10, n)) / 10;
    out.set(doc.docid, score);
  }

  return out;
}
