import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { analyticsDb, skillGapFrequency } from "@aperture/analytics";
import { VersionSummarySchema, MarketSuggestionSchema, type MasterResume } from "@aperture/shared";
import { createBuilderRoutes } from "../src/routes/builder.js";

const userId = "00000000-0000-4000-8000-000000000001";
const resume: MasterResume = {
  basics: { name: "Synthetic", email: "synthetic@example.test", phone: null, location: null, headline: null, links: [] },
  summary: null, experience: [], projects: [], education: [], skills: [], certifications: [],
  publications: [], awards: [], targetRoles: [" Engineer "],
};
test("builder route integration scopes loaders to the principal, filters roles and selects latest version scores", async () => {
  const calls: string[] = [];
  const now = new Date("2026-09-19T00:00:00Z");
  const app = new Hono();
  // Authentication itself is exercised by auth.test; this fixture supplies its verified result.
  app.use("*", async (c, next) => {
    c.set("user", { id: userId, email: "synthetic@example.test", subject: "synthetic",
      tier: "free", role: "user", orgId: null });
    await next();
  });
  app.route("/builder", createBuilderRoutes({
    loadProfile: async id => { calls.push(id); return { userId: id, masterResume: resume, version: 2, referenceList: null, updatedAt: now }; },
    loadGaps: async id => { calls.push(id); return [
      { skill: "Rust", role_type: "Engineer", listings_requiring: 1, listings_total: 2, frequency_pct: 50 },
      { skill: "Sales", role_type: "Sales", listings_requiring: 1, listings_total: 2, frequency_pct: 50 },
    ]; },
    loadVersions: async id => { calls.push(id); return [2, 1].map(version =>
      ({ id: String(version), userId: id, version, resume, note: null, createdAt: now })); },
    loadScores: async id => { calls.push(id); return [80, 60].map((value, index) =>
      ({ id: String(index), userId: id, profileVersion: 1, profileStrength: value,
        avgMatchScore: value, avgAtsScore: null, createdAt: new Date(now.getTime() - index * 1000) })); },
  }));
  const gaps = await app.request("/builder/market-suggestions?userId=attacker");
  assert.equal(gaps.status, 200);
  const suggestions = MarketSuggestionSchema.array().parse(await gaps.json());
  assert.deepEqual(suggestions.map(row => row.skill), ["Rust"]);
  const response = await app.request("/builder/versions");
  assert.equal(response.status, 200);
  const versions = VersionSummarySchema.array().parse(await response.json());
  assert.equal(versions[0]?.profileStrength, null);
  assert.equal(versions[1]?.profileStrength, 80);
  assert.equal(versions[1]?.avgAtsScore, null);
  assert.ok(calls.every(id => id === userId));
});
test("live in-memory DuckDB gap counts are JSON-safe and exclude another user's facts", async () => {
  process.env.DUCKDB_PATH = ":memory:";
  const connection = await analyticsDb();
  await connection.run(`INSERT INTO fact_listing_skills
    (listing_id, user_id, role_type, skill, required, user_has) VALUES
    ('00000000-0000-4000-8000-000000000010', '${userId}', 'Engineer', 'Rust', true, false),
    ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000002', 'Engineer', 'Secret', true, false)`);
  const rows = await skillGapFrequency(userId);
  assert.doesNotThrow(() => JSON.stringify(rows));
  const validated = MarketSuggestionSchema.array().parse(rows);
  assert.equal(validated.length, 1);
  assert.equal(validated[0]?.listings_requiring, 1);
  assert.equal(validated[0]?.frequency_pct, 100);
});
test("builder contracts reject malformed scores/counts and preserve actual zero scores", () => {
  const row = { version: 1, createdAt: "2026-09-19", profileStrength: 0 };
  assert.equal(VersionSummarySchema.parse(row).profileStrength, 0);
  assert.throws(() => VersionSummarySchema.parse({ ...row, avgMatchScore: 101 }));
  assert.throws(() => VersionSummarySchema.parse({ ...row, createdAt: "invalid" }));
  assert.throws(() => MarketSuggestionSchema.parse({ skill: "x", role_type: null,
    listings_requiring: Number.MAX_SAFE_INTEGER + 1, listings_total: 1, frequency_pct: 100 }));
});
