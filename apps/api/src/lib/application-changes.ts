import type { ApplicationPatch } from "@aperture/shared";

export function applicationChanges(current: {
  status: string; appliedAt: Date | null; events: { status: string; at: string }[];
}, patch: ApplicationPatch, now = new Date()) {
  const changed = patch.status !== undefined && patch.status !== current.status;
  return {
    ...patch,
    appliedAt: current.appliedAt ?? (changed && ["applied", "screening", "interviewing", "offer"].includes(patch.status!) ? now : null),
    events: changed ? [...current.events, { status: patch.status!, at: now.toISOString() }] : current.events,
  };
}
