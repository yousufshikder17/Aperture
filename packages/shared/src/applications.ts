import { z } from "zod";

export const ApplicationStatusSchema = z.enum([
  "saved", "applied", "screening", "interviewing", "offer", "rejected", "withdrawn",
]);
export const ApplicationCreateSchema = z.object({
  listingId: z.string().uuid(), status: ApplicationStatusSchema.default("saved"),
  notes: z.string().max(10000).optional(),
});
export const ApplicationPatchSchema = z.object({
  status: ApplicationStatusSchema.optional(), notes: z.string().max(10000).optional(),
}).refine(value => value.status !== undefined || value.notes !== undefined, "Provide status or notes");
export const ApplicationSchema = z.object({
  id: z.string().uuid(), listingId: z.string().uuid(), status: ApplicationStatusSchema,
  notes: z.string().nullable(), appliedAt: z.string().nullable(), createdAt: z.string(),
  events: z.array(z.object({ status: ApplicationStatusSchema, at: z.string() })),
  listing: z.object({ title: z.string(), company: z.string() }),
});
export type Application = z.infer<typeof ApplicationSchema>;
export type ApplicationCreate = z.infer<typeof ApplicationCreateSchema>;
export type ApplicationPatch = z.infer<typeof ApplicationPatchSchema>;
