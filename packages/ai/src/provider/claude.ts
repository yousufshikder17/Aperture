import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type {
  AIProvider,
  BatchItem,
  ContentPart,
  ModelTier,
  StructuredRequest,
  SystemBlock,
} from "./types.js";

// ClaudeProvider — primary, production-ready adapter.
// Quality tier uses the configured higher-accuracy model.
// fast tier: mechanical extraction/structuring/classification (Claude Haiku 4.5).
// Uses prompt caching for cacheable system blocks and the Message Batches API
// (50% price) for generateMany.

const MODELS: Record<ModelTier, string> = {
  quality: process.env.CLAUDE_MODEL_QUALITY ?? "claude-sonnet-4-6",
  fast: process.env.CLAUDE_MODEL_FAST ?? "claude-haiku-4-5",
};

function systemBlocks(system: SystemBlock[]) {
  return system.map((block) => ({
    type: "text" as const,
    text: block.text,
    ...(block.cacheable ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
}

function contentBlocks(parts: ContentPart[]) {
  return parts.map((part) =>
    part.type === "text"
      ? { type: "text" as const, text: part.text }
      : {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: part.mediaType,
            data: part.data,
          },
        },
  );
}

export class ClaudeProvider implements AIProvider {
  readonly name = "claude";
  private client: Anthropic;

  constructor() {
    // Zero-arg constructor resolves ANTHROPIC_API_KEY / auth profile from env.
    this.client = new Anthropic();
  }

  modelLabel(tier: ModelTier): string {
    return `claude:${MODELS[tier]}`;
  }

  async generate<T>(request: StructuredRequest<T>): Promise<T> {
    const response = await this.client.messages.parse({
      model: MODELS[request.tier],
      max_tokens: request.maxTokens,
      ...(request.reasoning && request.tier === "quality"
        ? { thinking: { type: "adaptive" as const } }
        : {}),
      system: systemBlocks(request.system),
      messages: [{ role: "user", content: contentBlocks(request.content) }],
      output_config: { format: zodOutputFormat(request.schema) },
    });

    if (!response.parsed_output) {
      throw new Error(
        `claude returned no parseable output (stop_reason: ${response.stop_reason})`,
      );
    }
    return response.parsed_output;
  }

  async generateMany<T>(items: BatchItem<T>[]): Promise<Map<string, T>> {
    if (items.length === 0) return new Map();

    const batch = await this.client.messages.batches.create({
      requests: items.map((item) => ({
        custom_id: item.id,
        params: {
          model: MODELS[item.request.tier],
          max_tokens: item.request.maxTokens,
          system: systemBlocks(item.request.system),
          messages: [{ role: "user" as const, content: contentBlocks(item.request.content) }],
          output_config: { format: zodOutputFormat(item.request.schema) },
        },
      })),
    });

    for (;;) {
      const status = await this.client.messages.batches.retrieve(batch.id);
      if (status.processing_status === "ended") break;
      await new Promise((r) => setTimeout(r, 30_000));
    }

    const schemaById = new Map(items.map((i) => [i.id, i.request.schema]));
    const results = new Map<string, T>();
    for await (const result of await this.client.messages.batches.results(batch.id)) {
      if (result.result.type !== "succeeded") continue;
      const schema = schemaById.get(result.custom_id);
      if (!schema) continue;
      const text = result.result.message.content.find((b) => b.type === "text");
      if (!text || text.type !== "text") continue;
      const parsed = schema.safeParse(JSON.parse(text.text));
      if (parsed.success) results.set(result.custom_id, parsed.data as T);
    }
    return results;
  }
}
