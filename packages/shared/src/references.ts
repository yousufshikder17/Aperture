import { z } from "zod";

// Reference contacts are structured separately from resume content.

export const ReferenceSchema = z.object({
  name: z.string(),
  relationship: z.string().describe("e.g. direct manager, peer, professor, client"),
  title: z.string(),
  company: z.string(),
  seniority: z.enum(["ic", "manager", "director", "vp", "exec"]),
  lastWorkedTogether: z.string().describe("ISO date — recency signal"),
  contact: z.string().nullable(),
  notes: z.string().nullable(),
});

export const ReferenceListSchema = z.object({
  references: z.array(ReferenceSchema),
});

export type Reference = z.infer<typeof ReferenceSchema>;
export type ReferenceList = z.infer<typeof ReferenceListSchema>;
