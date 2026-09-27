import { api, ApiError } from "@/lib/server-api";
import { ComplexityAssessmentSchema, ResourceSummarySchema, type ResourceSummary } from "@aperture/shared";
import { ResourcesView as ResourceDirectory } from "./view";
import "./resources.css";

export default async function Resources({ searchParams }: {
  searchParams: Promise<{ skill?: string; level?: string }>;
}) {
  const { skill, level: requestedLevel } = await searchParams;
  const level = ComplexityAssessmentSchema.shape.level.safeParse(requestedLevel).data ?? "";
  let rows: ResourceSummary[] = [];
  let error: string | null = null;
  try {
    rows = ResourceSummarySchema.array().parse(await api(`/resources${skill ? `?skill=${encodeURIComponent(skill)}` : ""}`));
  } catch (cause) {
    error = cause instanceof ApiError && cause.status === 401
      ? "Sign in through Account to view learning resources."
      : "Resources could not be loaded. Try applying the filter again.";
  }
  return <ResourceDirectory rows={rows} skill={skill} level={level} error={error} />;
}
