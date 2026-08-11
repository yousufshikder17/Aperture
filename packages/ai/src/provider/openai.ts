import OpenAI from "openai";
import { z } from "zod";
import type {
  AIProvider,
  BatchItem,
  ContentPart,
  ModelTier,
  StructuredRequest,
} from "./types.js";

// OpenAIProvider — alternative production provider (when cost matters).
// Same task routing as Claude:
//   quality (higher-accuracy structured work): gpt-4o
//   fast (mechanical work):     gpt-4o-mini
// Structured output via response_format json_schema; results are validated
// against the request's Zod schema so callers get identical guarantees.

const MODELS: Record<ModelTier, string> = {
  quality: process.env.OPENAI_MODEL_QUALITY ?? "gpt-4o",
  fast: process.env.OPENAI_MODEL_FAST ?? "gpt-4o-mini",
};

const BATCH_CONCURRENCY = 4;

function userParts(content: ContentPart[]) {
  return content.map((part) =>
    part.type === "text"
      ? { type: "text" as const, text: part.text }
      : {
          type: "image_url" as const,
          image_url: { url: `data:${part.mediaType};base64,${part.data}` },
        },
  );
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set (provider: openai)");
    this.client = new OpenAI({ apiKey });
  }

  modelLabel(tier: ModelTier): string {
    return `openai:${MODELS[tier]}`;
  }

  async generate<T>(request: StructuredRequest<T>): Promise<T> {
    const response = await this.client.chat.completions.create({
      model: MODELS[request.tier],
      max_completion_tokens: request.maxTokens,
      messages: [
        // OpenAI has no prompt-caching breakpoints to place; cacheable blocks
        // are concatenated (automatic prefix caching may apply server-side).
        { role: "system", content: request.system.map((b) => b.text).join("\n\n") },
        { role: "user", content: userParts(request.content) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "structured_output",
          schema: z.toJSONSchema(request.schema) as Record<string, unknown>,
        },
      },
    });

    const text = response.choices[0]?.message?.content;
    if (!text) {
      throw new Error(
        `openai returned no content (finish_reason: ${response.choices[0]?.finish_reason})`,
      );
    }
    return request.schema.parse(JSON.parse(text));
  }

  // Bounded-concurrency loop (the OpenAI Batch API is a possible future
  // optimization behind this same method, mirroring Claude's adapter).
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
          console.error(`openai batch item ${item.id} failed:`, err);
        }
      }
    });

    await Promise.all(workers);
    return results;
  }
}
