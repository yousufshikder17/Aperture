import { eq, isNull } from "drizzle-orm";
import { db, resources } from "@aperture/db";
import { RegistrySchema, type ComplexityAssessment } from "@aperture/shared";
import { assessComplexity } from "@aperture/ai";

// Pull the configured registry, upsert entries, and classify missing complexity
// metadata at index time. Registry-provided tags avoid provider calls;
// COMPLEXITY_SOURCE=registry-only disables provider classification entirely.

export async function syncRegistry(): Promise<{
  entries: number;
  fromRegistry: number;
  fromAi: number;
}> {
  const url = process.env.RESOURCE_REGISTRY_URL;
  if (!url) throw new Error("RESOURCE_REGISTRY_URL is not set");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`registry fetch failed: ${res.status}`);
  const registry = RegistrySchema.parse(await res.json());

  let fromRegistry = 0;
  for (const entry of registry.entries) {
    const base = {
      title: entry.title,
      url: entry.url,
      kind: entry.kind,
      skills: entry.skills,
      free: entry.free,
    };
    const provided: ComplexityAssessment | undefined = entry.complexity;
    const tagFields = provided
      ? {
          level: provided.level,
          timeCommitment: provided.timeCommitment,
          prerequisites: provided.prerequisites,
          summary: provided.summary,
          complexity: provided,
          indexedAt: new Date(),
        }
      : {};

    await db()
      .insert(resources)
      .values({ id: entry.id, ...base, ...tagFields })
      .onConflictDoUpdate({
        target: resources.id,
        set: { ...base, ...tagFields }, // never clears a prior AI indexing
      });
    if (provided) fromRegistry++;
  }

  if ((process.env.COMPLEXITY_SOURCE ?? "registry-first").toLowerCase() === "registry-only") {
    return { entries: registry.entries.length, fromRegistry, fromAi: 0 };
  }

  // Batch-assess everything still lacking tags (new entries, prior failures).
  const unindexed = await db().select().from(resources).where(isNull(resources.indexedAt));
  if (unindexed.length === 0) {
    return { entries: registry.entries.length, fromRegistry, fromAi: 0 };
  }

  const pending = registry.entries.filter((e) => unindexed.some((u) => u.id === e.id));
  const assessments = await assessComplexity(pending);

  let fromAi = 0;
  for (const [id, complexity] of assessments) {
    await db()
      .update(resources)
      .set({
        level: complexity.level,
        timeCommitment: complexity.timeCommitment,
        prerequisites: complexity.prerequisites,
        summary: complexity.summary,
        complexity,
        indexedAt: new Date(),
      })
      .where(eq(resources.id, id));
    fromAi++;
  }

  return { entries: registry.entries.length, fromRegistry, fromAi };
}
