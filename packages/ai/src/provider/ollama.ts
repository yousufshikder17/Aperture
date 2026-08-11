import { z } from "zod";
import type {
  AIProvider,
  BatchItem,
  ContentPart,
  ModelTier,
  StructuredRequest,
} from "./types.js";

// OllamaProvider — local development provider. Fully offline iteration,
// privacy-sensitive testing, zero API cost.
//
// Model is config-driven — whatever the user has installed:
//   OLLAMA_MODEL            both tiers (required)
//   OLLAMA_MODEL_QUALITY /  optional per-tier overrides (e.g. a larger model
//   OLLAMA_MODEL_FAST       for judgment, a small one for mechanical work)
//
// Graceful degradation: availability is checked (once, cheaply) before the
// first real call, so a stopped daemon surfaces as one actionable message
// instead of a raw ECONNREFUSED from deep inside a pipeline.

const BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const BATCH_CONCURRENCY = 2; // local hardware — keep it gentle

function models(): Record<ModelTier, string> {
  const base = process.env.OLLAMA_MODEL;
  const quality = process.env.OLLAMA_MODEL_QUALITY ?? base;
  const fast = process.env.OLLAMA_MODEL_FAST ?? base;
  if (!quality || !fast) {
    throw new Error(
      "OLLAMA_MODEL is not set (provider: ollama). Set it to an installed model, e.g. OLLAMA_MODEL=llama3.1 — see `ollama list`.",
    );
  }
  return { quality, fast };
}

interface OllamaMessage {
  role: "system" | "user";
  content: string;
  images?: string[];
}

function toMessages(request: StructuredRequest<unknown>): OllamaMessage[] {
  const text = request.content
    .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n\n");
  const images = request.content
    .filter((p): p is Extract<ContentPart, { type: "image" }> => p.type === "image")
    .map((p) => p.data);

  return [
    { role: "system", content: request.system.map((b) => b.text).join("\n\n") },
    { role: "user", content: text, ...(images.length ? { images } : {}) },
  ];
}

export class OllamaProvider implements AIProvider {
  readonly name = "ollama";
  private available: boolean | null = null;

  modelLabel(tier: ModelTier): string {
    return `ollama:${models()[tier]}`;
  }

  private async ensureAvailable(): Promise<void> {
    if (this.available) return;
    try {
      const res = await fetch(`${BASE_URL}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      this.available = true;
    } catch {
      this.available = null; // re-probe on the next call
      throw new Error(
        `Ollama is not reachable at ${BASE_URL}. Start it with \`ollama serve\` (and \`ollama pull <model>\` if needed), or route to a hosted provider via FAST_PROVIDER/QUALITY_PROVIDER.`,
      );
    }
  }

  async generate<T>(request: StructuredRequest<T>): Promise<T> {
    await this.ensureAvailable();

    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: models()[request.tier],
        messages: toMessages(request),
        // Ollama structured outputs: constrain generation to the JSON schema.
        format: z.toJSONSchema(request.schema),
        stream: false,
        options: { num_predict: request.maxTokens },
      }),
    });
    if (!res.ok) {
      throw new Error(`ollama /api/chat failed: ${res.status} ${await res.text()}`);
    }

    const body = (await res.json()) as { message?: { content?: string } };
    const text = body.message?.content;
    if (!text) throw new Error("ollama returned no message content");
    return request.schema.parse(JSON.parse(text));
  }

  async generateMany<T>(items: BatchItem<T>[]): Promise<Map<string, T>> {
    const results = new Map<string, T>();
    const queue = [...items];

    const workers = Array.from({ length: BATCH_CONCURRENCY }, async () => {
      for (;;) {
        const item = queue.shift();
        if (!item) return;
        try {
          results.set(item.id, await this.generate(item.request));
        } catch (err) {
          // Omit failures — callers re-queue unindexed items on the next run.
          console.error(`ollama batch item ${item.id} failed:`, err);
        }
      }
    });

    await Promise.all(workers);
    return results;
  }
}
