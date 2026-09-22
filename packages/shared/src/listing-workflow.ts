import { z } from "zod";
import { ListingSchema, ListingSourceSchema, MatchScoreSchema } from "./listing.js";

export const ListingRowSchema = z.object({
  listing: ListingSchema, match: MatchScoreSchema.nullable(),
  profileVersion: z.number().int().nullable(),
});
export const ListingRowsSchema = z.array(ListingRowSchema);
export const FeedScanSchema = z.object({
  scanned: z.number().int().nonnegative(), inserted: z.number().int().nonnegative(),
  configured: z.number().int().nonnegative(), succeeded: z.number().int().nonnegative(),
  failedSources: z.array(ListingSourceSchema),
});
export type ListingRow = z.infer<typeof ListingRowSchema>;
export type ListingRows = z.infer<typeof ListingRowsSchema>;
