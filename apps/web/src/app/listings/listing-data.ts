import { FeedScanSchema } from "@aperture/shared";
import { ApiError, UpgradeRequiredError } from "../../lib/api";

export function safeListingUrl(value: string): string | null {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

export function listingError(error: unknown): string {
  if (error instanceof UpgradeRequiredError) return "Your plan does not include this action, or its allowance is exhausted. Check your account.";
  if (error instanceof ApiError) {
    if (error.status === 401) return "Your session has expired. Sign in through Account, then retry.";
    if (error.status === 403) return "Scanning shared feeds requires an administrator account. Other users can refresh listings and score matches.";
    if (error.status === 404) return "This listing or saved result is unavailable. Return to Listings or retry loading.";
    if (error.status === 409) return "Save a master resume in Builder before scoring a listing.";
  }
  return "The request could not be completed. Your saved results have not been replaced here. Please retry.";
}

export function scanSummary(value: unknown): string {
  const scan = FeedScanSchema.parse(value);
  if (!scan.configured) return "No feeds are configured. Ask the operator to configure LinkedIn or Indeed RSS feeds.";
  if (!scan.succeeded) return "No configured feeds could be read. Existing listings are unchanged; retry later.";
  const result = `${scan.inserted} new listings added from ${scan.scanned} valid entries. Scanning does not score matches.`;
  return scan.failedSources.length ? `${result} Some feeds failed: ${scan.failedSources.join(", ")}. Retry later.` : result;
}
