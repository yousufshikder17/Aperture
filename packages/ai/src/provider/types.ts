import type { z } from "zod";

// AIProvider — the pluggable adapter boundary (same philosophy as Fieldfare's
// backend adapters). Calling code (pipelines, routes, jobs) NEVER imports a
// provider SDK directly; everything goes through this interface. Adapters are
// selected at runtime through environment configuration.

/**
 * Task-appropriate model selection. Pipelines declare intent, adapters map to
 * concrete models:
 *  - "fast"    — simple/mechanical work: transcription, structuring, batch
 *                classification. Cheaper, faster model.
 *  - "quality" — higher-accuracy structured extraction or classification.
 */
export type ModelTier = "fast" | "quality";

export interface SystemBlock {
  text: string;
  /**
   * Hint that this block is byte-identical across many calls (e.g. the master
   * profile during a per-listing scoring run). Adapters that support prompt
   * caching (Claude) use it; others ignore it.
   */
  cacheable?: boolean;
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: "image/png" | "image/jpeg" | "image/webp"; data: string }; // base64

export interface StructuredRequest<T> {
  tier: ModelTier;
  system: SystemBlock[];
  /** One user turn. All Aperture pipelines are single-turn. */
  content: ContentPart[];
  /** Zod schema — both the structured-output contract and the runtime validator. */
  schema: z.ZodType<T>;
  maxTokens: number;
  /** Deep-judgment hint. Claude maps it to adaptive thinking; Gemini to its default reasoning. */
  reasoning?: boolean;
}

export interface BatchItem<T> {
  id: string;
  request: StructuredRequest<T>;
}

export interface AIProvider {
  readonly name: string;
  /** Human-readable "provider:model" label for a tier — stored with reports for provenance. */
  modelLabel(tier: ModelTier): string;
  /** One structured completion, validated against the request schema. */
  generate<T>(request: StructuredRequest<T>): Promise<T>;
  /**
   * Many independent completions, keyed by id. Adapters choose the mechanism:
   * Claude uses the Message Batches API (50% price, offline); Gemini runs a
   * bounded-concurrency loop. Failed items are omitted from the result map —
   * callers re-queue on the next run.
   */
  generateMany<T>(items: BatchItem<T>[]): Promise<Map<string, T>>;
}
