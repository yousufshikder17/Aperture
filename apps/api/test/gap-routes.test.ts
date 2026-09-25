import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { MasterResume } from "@aperture/shared";
import { createAnalyticsRoutes } from "../src/routes/analytics.js";
import { createBuilderRoutes } from "../src/routes/builder.js";
import { loadSkillGaps } from "../src/services/gap-analysis.js";

test("both gap routes share live role totals, reflect profile edits, and ignore caller user IDs", async () => {
  const resume: MasterResume = {
    basics: { name: "Test", email: "test@example.test", phone: null, location: null, headline: null, links: [] },
    summary: null, skills: [], experience: [], projects: [], education: [], certifications: [],
    publications: [], awards: [], targetRoles: ["Engineer", "Analyst"],
  };
  const calls: string[] = [];
  const store = {
    loadResume: async (id: string) => { calls.push(id); return id === "owner" ? resume : null; },
    loadListings: async (id: string) => {
      calls.push(id);
      assert.equal(id, "owner");
      return [{ title: "Engineer", description: "Java" }, { title: "Engineer", description: "Python" },
        { title: "Analyst", description: "SQL" }];
    },
  };
  const app = new Hono();
  app.use("*", async (c, next) => {
    const id = c.req.header("authorization");
    if (!id) return c.json({}, 401);
    c.set("user", { id, subject: id, email: "test@example.test", role: "user", tier: "free", orgId: null });
    await next();
  });
  const loadGaps = (id: string) => loadSkillGaps(id, store);
  app.route("/analytics", createAnalyticsRoutes({ loadGaps }));
  app.route("/builder", createBuilderRoutes({ loadGaps }));
  const paths = ["/analytics/gaps", "/builder/market-suggestions"];
  async function readBoth() {
    const data = [];
    for (const path of paths) {
      const response = await app.request(path + "?userId=attacker", { headers: { authorization: "owner" } });
      assert.equal(response.status, 200);
      data.push(await response.json());
    }
    assert.deepEqual(data[0], data[1]);
    return data[0] as Array<{ skill: string; listings_total: number; frequency_pct: number }>;
  }
  const initial = await readBoth();
  assert.equal(initial.find(g => g.skill === "java")?.frequency_pct, 50);
  assert.equal(initial.find(g => g.skill === "sql")?.frequency_pct, 100);
  resume.summary = "Java";
  assert(!(await readBoth()).some(g => g.skill === "java"));
  assert(calls.every(id => id === "owner"));
  for (const path of paths) {
    assert.equal((await app.request(path)).status, 401);
    assert.deepEqual(await (await app.request(path, { headers: { authorization: "other" } })).json(), []);
  }
});
