import type { MasterResume } from "@aperture/shared";

// Deterministic keyword extraction — the shared core of the heuristic (manual)
// engines and the DuckDB ETL's listing-skill extraction. No AI involved.

const STOPWORDS = new Set(
  `a about above after again all also an and any are as at be because been but by can could did do does for from had has have how i if in into is it its just more most no not of on or our other out over so than that the their them then there these they this to under up we what when where which who will with would you your years experience team work working strong ability plus etc join role position candidate applicants required requirements preferred qualifications responsibilities skills including include`.split(
    /\s+/,
  ),
);

// Compact tech-skill dictionary: multiword terms matched by substring, single
// terms matched by token. Deliberately broad-strokes — the registry and each
// user's own profile/target roles extend it at call time.
export const SKILL_DICTIONARY = [
  "typescript", "javascript", "python", "java", "kotlin", "swift", "rust", "go", "c++", "c#",
  "react", "react native", "next.js", "vue", "angular", "svelte", "node.js", "hono", "express",
  "html", "css", "tailwind", "graphql", "rest", "grpc", "websockets",
  "postgres", "postgresql", "mysql", "sqlite", "mongodb", "redis", "duckdb", "sql", "nosql",
  "aws", "gcp", "azure", "docker", "kubernetes", "terraform", "ci/cd", "github actions", "linux",
  "machine learning", "deep learning", "pytorch", "tensorflow", "scikit-learn", "nlp",
  "computer vision", "llm", "data science", "pandas", "numpy", "spark", "airflow", "etl",
  "embedded systems", "firmware", "rtos", "microcontrollers", "fpga", "verilog", "pcb",
  "edge ai", "drone protocols", "mavlink", "ros", "robotics", "iot", "can bus",
  "security testing", "penetration testing", "network security", "cryptography", "oauth",
  "distributed systems", "microservices", "system design", "event driven", "kafka", "rabbitmq",
  "agile", "scrum", "git", "unit testing", "integration testing", "tdd",
] as const;

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#./\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

export interface RankedKeyword {
  term: string;
  count: number;
  inDictionary: boolean;
}

/**
 * Ranked keywords from free text. Dictionary terms (built-in + extraTerms,
 * e.g. the user's profile skills and target roles) are matched even when
 * multiword and ranked above plain frequent tokens.
 */
export function extractKeywords(text: string, extraTerms: string[] = []): RankedKeyword[] {
  const norm = normalize(text);
  const dictionary = [...new Set([...SKILL_DICTIONARY, ...extraTerms.map(normalize)])].filter(
    Boolean,
  );

  const found = new Map<string, RankedKeyword>();

  for (const term of dictionary) {
    let count = 0;
    let index = norm.indexOf(term);
    while (index !== -1) {
      count++;
      index = norm.indexOf(term, index + term.length);
    }
    if (count > 0) found.set(term, { term, count, inDictionary: true });
  }

  const frequency = new Map<string, number>();
  for (const token of tokens(text)) {
    frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }
  for (const [term, count] of frequency) {
    // Frequent non-dictionary tokens still matter (domain nouns the dictionary
    // doesn't know), but only above a repetition threshold.
    if (count >= 2 && !found.has(term)) {
      found.set(term, { term, count, inDictionary: false });
    }
  }

  return [...found.values()].sort(
    (a, b) => Number(b.inDictionary) - Number(a.inDictionary) || b.count - a.count,
  );
}

/** Normalized haystack of everything the resume demonstrates, for substring checks. */
export function resumeText(profile: MasterResume): string {
  const parts: string[] = [
    profile.summary ?? "",
    ...profile.skills.map((s) => s.name),
    ...profile.experience.flatMap((e) => [e.title, e.company, ...e.bullets, ...e.skills]),
    ...profile.projects.flatMap((p) => [p.name, p.description, ...p.bullets, ...p.skills]),
    ...profile.certifications,
  ];
  return normalize(parts.join(" "));
}

/** Skill terms a listing asks for, using dictionary + the user's own vocabulary. */
export function listingSkillTerms(
  listingText: string,
  profile?: MasterResume,
  limit = 25,
): RankedKeyword[] {
  const extra = profile
    ? [...profile.skills.map((s) => s.name), ...profile.targetRoles]
    : [];
  return extractKeywords(listingText, extra).slice(0, limit);
}
