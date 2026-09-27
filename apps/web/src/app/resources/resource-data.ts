import { ApiError, UpgradeRequiredError } from "../../lib/api";

export const progressLabel = { not_started: "Not started", in_progress: "In progress", completed: "Completed" };
export function archiveError(error: unknown) {
  if (error instanceof UpgradeRequiredError) return "Your resource save allowance is exhausted. You can still edit resources already in your archive. Check your plan in Account.";
  if (error instanceof ApiError) {
    if (error.status === 401) return "Sign in through Account, then retry.";
    if (error.status === 404) return "This resource or saved entry is no longer available. Reload and try again.";
    if (error.status === 400) return "Check your progress and notes, then try again. Notes can contain up to 10,000 characters.";
  }
  return "Could not complete the request. Your edits are still here. Please retry.";
}
