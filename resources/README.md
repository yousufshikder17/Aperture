# Aperture Resource Registry

Curated directory of free (and occasionally paid-but-worth-it) learning
resources, mapped to job-skill gaps. The platform pulls this file and indexes it —
**complexity tags (level, time commitment, prerequisites) can be computed by the configured
provider at index time**, so entries only need the basics.

## Registry workflow

1. Add an entry to `registry.json` for review.
2. Validation checks entries against the schema below (`RegistryEntrySchema` in
   `packages/shared/src/resources.ts` is the source of truth).
3. Once accepted, the platform's `resource-sync` job picks up new entries on its next run and
   submits them for complexity assessment.

## Entry schema

```jsonc
{
  "id": "stable-kebab-slug",          // unique, never reused
  "title": "Human-readable title",
  "url": "https://…",
  "kind": "youtube | course | documentation | tutorial | book | repo | article",
  "skills": ["skill gap this addresses", "…"],  // match skill names candidates actually have gaps in
  "free": true,
  "submittedBy": "github-handle or null",
  // OPTIONAL — if you know the resource well, supply the tags yourself and the
  // platform indexes your entry with zero AI calls (your judgment beats a model's):
  "complexity": {
    "level": "beginner | intermediate | advanced",
    "timeCommitment": "hours | days | weeks | months",
    "prerequisites": ["what a learner needs first"],
    "summary": "one sentence: what the learner gets out of it"
  }
}
```

## Guidelines

- **Free first.** Paid resources are allowed only when clearly best-in-class (mark `"free": false`).
- **Skills are the join key.** Use the same phrasing job listings use ("pytorch", not "PyTorch fundamentals") — gap detection matches on these.
- Dead links get removed during registry maintenance.
- Well-documented project repositories can be useful resources when they directly address a skill gap (e.g. gap: *drone protocols* → resource: *Fieldfare*).
