import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { analyticsDb } from "@aperture/analytics";
import { createAnalyticsRoutes } from "../src/routes/analytics.js";

test("populated analytics endpoints serialize counts and timestamps and isolate users", async () => {
  process.env.DUCKDB_PATH = ":memory:";
  const userId = "00000000-0000-4000-8000-000000000001";
  const otherId = "00000000-0000-4000-8000-000000000002";
  const duck = await analyticsDb();
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user", { id: userId, tier: "pro", role: "user", subject: "test:analytics",
      email: "analytics@example.test", orgId: null });
    await next();
  });
  app.route("/", createAnalyticsRoutes());
  try {
    for (const path of ["/response-rates", "/trajectory"]) {
      const response = await app.request(path);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), []);
    }
    for (const owner of [userId, otherId]) {
      await duck.run(`INSERT INTO fact_applications VALUES (?, ?, ?, 'Engineer', 'Remote',
        'unknown', 'screening', '2026-10-01', true, 1)`, [owner, owner, owner]);
      await duck.run(`INSERT INTO fact_score_snapshots VALUES (?, 1, 70, 80, NULL, '2026-10-01 12:30:00')`, [owner]);
    }
    const rates = await app.request("/response-rates");
    assert.equal(rates.status, 200);
    assert.deepEqual(await rates.json(), [{ role_type: "Engineer", market: "Remote",
      company_tier: "unknown", applications: 1, responses: 1, response_rate_pct: 100 }]);
    const trajectory = await app.request("/trajectory");
    assert.equal(trajectory.status, 200);
    const rows = await trajectory.json() as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.profile_version, 1);
    assert.equal(row.profile_strength, 70);
    assert.equal(row.avg_ats_score, null);
    assert.equal(typeof row.snapshot_at, "string");
    assert.match(String(row.snapshot_at), /^2026-10-01[ T]12:30:00/);
  } finally { duck.closeSync(); }
});
