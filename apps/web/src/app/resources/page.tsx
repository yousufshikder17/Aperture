import React from "react";
import { ResourcesView, type ResourceRow } from "./view";
import { api, ApiError } from "@/lib/server-api";

export default async function Resources({
  searchParams,
}: {
  searchParams: Promise<{ skill?: string; level?: string }>;
}) {
  const { skill, level: requestedLevel } = await searchParams;
  const level = requestedLevel ?? "";
  let rows: ResourceRow[] = [];
  let error: string | null = null;
  try {
    rows = await api<ResourceRow[]>(`/resources${skill ? `?skill=${encodeURIComponent(skill)}` : ""}`);
  } catch (cause) {
    error = cause instanceof ApiError && cause.status === 401
      ? "Sign in through Account to view learning resources."
      : "Resources could not be loaded. Try applying the filter again.";
  }

  return <ResourcesView rows={rows} error={error} skill={skill} level={level} />;
}
