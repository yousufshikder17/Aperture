import React from "react";
import { GapAnalysisView, type SkillGap } from "./view";
import { api, ApiError } from "@/lib/server-api";

export default async function GapAnalysis() {
  let gaps: SkillGap[] = [];
  let error = "";
  try {
    gaps = await api<SkillGap[]>("/analytics/gaps");
  } catch (cause) {
    error = cause instanceof ApiError && cause.status === 401
      ? "Sign in through Account to view gap analysis."
      : "Could not load gap analysis. Try again shortly.";
  }

  return <GapAnalysisView gaps={gaps} error={error} />;
}
