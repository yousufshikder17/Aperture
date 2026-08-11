import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type {
  AIProvider,
  BatchItem,
  ContentPart,
  ModelTier,
  StructuredRequest,
} from "./types.js";

// GeminiProvider is the default development adapter.
// Default models favor low-cost structured tasks:
//   quality: gemini-2.5-flash       fast: gemini-2.5-flash-lite
// Structured output via responseJsonSchema; results are still validated with
// the request's Zod schema, so adapters provide the same runtime guarantee.

const MODELS: Record<ModelTier, string> = {
  quality: process.env.GEMINI_MODEL_QUALITY ?? "gemini-2.5-flash",
  fast: process.env.GEMINI_MODEL_FAST ?? "gemini-2.5-flash-lite",
};

const BATCH_CONCURRENCY = 4;

function parts(content: ContentPart[]) {
  return content.map((part) =>
    part.type === "text"
      ? { text: part.text }
      : { inlineData: { mimeType: part.mediaType, data: part.data } },
  );
}

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  private client: GoogleGenAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set (AI_PROVIDER=gemini)");
    this.client = new GoogleGenAI({ apiKey });
  }

  modelLabel(tier: ModelTier): string {
    return `gemini:${MODELS[tier]}`;
  }

  async generate<T>(request: StructuredRequest<T>): Promise<T> {
    const response = await this.client.models.generateContent({
      model: MODELS[request.tier],
      contents: [{ role: "user", parts: parts(request.content) }],
      config: {
        // Gemini has no prompt-caching breakpoint concept; cacheable blocks are
        // simply concatenated (implicit caching may still kick in server-side).
        systemInstruction: request.system.map((b) => b.text).join("\n\n"),
        responseMimeType: "application/json",
        responseJsonSchema: z.toJSONSchema(request.schema),
        maxOutputTokens: request.maxTokens,
      },
    });

    const text = response.text;
    if (!text) throw new Error("gemini returned no text output");
    return request.schema.parse(JSON.parse(text));
  }

  // Gemini's batch endpoint isn't wired here; a bounded-concurrency loop keeps
  // dev-tier indexing simple and inside free-tier rate limits.
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
          console.error(`gemini batch item ${item.id} failed:`, err);
        }
      }
    });

    await Promise.all(workers);
    return results;
  }
}
