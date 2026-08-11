import type { AIProvider, BatchItem, ModelTier, StructuredRequest } from "./types.js";
import { ClaudeProvider } from "./claude.js";
import { GeminiProvider } from "./gemini.js";
import { OpenAIProvider } from "./openai.js";
import { OllamaProvider } from "./ollama.js";

export type { AIProvider, BatchItem, ContentPart, ModelTier, StructuredRequest, SystemBlock } from "./types.js";
export { ClaudeProvider } from "./claude.js";
export { GeminiProvider } from "./gemini.js";
export { OpenAIProvider } from "./openai.js";
export { OllamaProvider } from "./ollama.js";

export type ProviderName = "claude" | "gemini" | "openai" | "ollama";

const adapters = new Map<ProviderName, AIProvider>();

function adapter(name: ProviderName): AIProvider {
  let instance = adapters.get(name);
  if (instance) return instance;
  switch (name) {
    case "claude":
      instance = new ClaudeProvider();
      break;
    case "gemini":
      instance = new GeminiProvider();
      break;
    case "openai":
      instance = new OpenAIProvider();
      break;
    case "ollama":
      instance = new OllamaProvider();
      break;
  }
  adapters.set(name, instance);
  return instance;
}

function parseName(raw: string, source: string): ProviderName {
  const name = raw.toLowerCase();
  if (name === "claude" || name === "gemini" || name === "openai" || name === "ollama") {
    return name;
  }
  throw new Error(`Unknown provider "${raw}" in ${source}. Supported: claude, gemini, openai, ollama.`);
}

function resolveName(tier: ModelTier): ProviderName {
  const tierVariable = tier === "fast"
    ? { value: process.env.FAST_PROVIDER, source: "FAST_PROVIDER" }
    : { value: process.env.QUALITY_PROVIDER, source: "QUALITY_PROVIDER" };
  if (tierVariable.value) return parseName(tierVariable.value, tierVariable.source);
  if (process.env.AI_PROVIDER) return parseName(process.env.AI_PROVIDER, "AI_PROVIDER");
  if (process.env.DEV_PROVIDER) return parseName(process.env.DEV_PROVIDER, "DEV_PROVIDER");
  return "gemini";
}

class RoutedProvider implements AIProvider {
  get name(): string {
    const fast = resolveName("fast");
    const quality = resolveName("quality");
    return fast === quality ? fast : `fast=${fast},quality=${quality}`;
  }

  modelLabel(tier: ModelTier): string {
    return adapter(resolveName(tier)).modelLabel(tier);
  }

  generate<T>(request: StructuredRequest<T>): Promise<T> {
    return adapter(resolveName(request.tier)).generate(request);
  }

  async generateMany<T>(items: BatchItem<T>[]): Promise<Map<string, T>> {
    const groups = new Map<AIProvider, BatchItem<T>[]>();
    for (const item of items) {
      const target = adapter(resolveName(item.request.tier));
      groups.set(target, [...(groups.get(target) ?? []), item]);
    }

    const results = new Map<string, T>();
    for (const [target, group] of groups) {
      for (const [id, value] of await target.generateMany(group)) {
        results.set(id, value);
      }
    }
    return results;
  }
}

const routed = new RoutedProvider();

export function getProvider(): AIProvider {
  return routed;
}

export function modelLabel(tier: ModelTier): string {
  return routed.modelLabel(tier);
}

export function profileSystem(instructions: string, profileJson: string) {
  return [
    { text: instructions },
    { text: `<candidate_profile>\n${profileJson}\n</candidate_profile>`, cacheable: true },
  ];
}
