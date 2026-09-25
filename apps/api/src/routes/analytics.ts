import { Hono } from "hono";
import { responseRates, scoreTrajectory } from "@aperture/analytics";
import { loadSkillGaps } from "../services/gap-analysis.js";

export function createAnalyticsRoutes({ loadGaps = loadSkillGaps }: { loadGaps?: typeof loadSkillGaps } = {}) {
  const routes = new Hono();
  routes.get("/gaps", async c => c.json(await loadGaps(c.get("user").id)));
  routes.get("/response-rates", async c => c.json(await responseRates(c.get("user").id)));
  routes.get("/trajectory", async c => c.json(await scoreTrajectory(c.get("user").id)));
  return routes;
}
export const analyticsRoutes = createAnalyticsRoutes();
