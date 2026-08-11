import { Hono } from "hono";
import { responseRates, scoreTrajectory, skillGapFrequency } from "@aperture/analytics";

export const analyticsRoutes = new Hono();

analyticsRoutes.get("/gaps", async (c) => {
  return c.json(await skillGapFrequency(c.get("user").id));
});

analyticsRoutes.get("/response-rates", async (c) => {
  return c.json(await responseRates(c.get("user").id));
});

analyticsRoutes.get("/trajectory", async (c) => {
  return c.json(await scoreTrajectory(c.get("user").id));
});
