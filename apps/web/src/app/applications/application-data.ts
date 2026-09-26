import { ApiError } from "../../lib/api";

export const statusLabel = (status: string) => status.charAt(0).toUpperCase() + status.slice(1);
export function applicationError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Sign in through Account, then retry. Your edits are still here.";
    if (error.status === 404) return "This application or listing is no longer available. Refresh the tracker and try again.";
    if (error.status === 400) return "Check the selected listing, status, and notes, then try again.";
  }
  return "Could not complete the request. Your edits are still here. Please retry.";
}
