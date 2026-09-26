import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { ApplicationCreateSchema, ApplicationPatchSchema } from "@aperture/shared";
import { applicationStore } from "../services/applications.js";

export function createApplicationRoutes(store?: ReturnType<typeof applicationStore>) {
  const routes = new Hono();
  const storage = () => store ?? applicationStore();
  routes.get("/", async c => c.json(await storage().list(c.get("user").id)));
  routes.post("/", zValidator("json", ApplicationCreateSchema), async c => {
    const row = await storage().create(c.get("user").id, c.req.valid("json"));
    return row ? c.json(row, 201) : c.json({ error: "listing_not_found" }, 404);
  });
  routes.patch("/:id", zValidator("param", z.object({ id: z.string().uuid() })),
    zValidator("json", ApplicationPatchSchema), async c => {
      const row = await storage().update(c.get("user").id, c.req.valid("param").id, c.req.valid("json"));
      return row ? c.json(row) : c.json({ error: "not_found" }, 404);
    });
  return routes;
}
export const applicationRoutes = createApplicationRoutes();
