import React from "react";
import type { ResourceSummary } from "@aperture/shared";
import { safeListingUrl } from "../listings/listing-data";

export function ResourceDetails({ resource }: { resource: ResourceSummary }) {
  const url = safeListingUrl(resource.url);
  return <>
    <h2>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{resource.title} <span className="muted">(new tab)</span></a> : resource.title}</h2>
    <p className="muted">{[resource.kind, resource.level, resource.timeCommitment].filter(Boolean).join(" · ")}</p>
    {resource.summary && <p>{resource.summary}</p>}
    <p className="muted">Covers: {resource.skills.join(", ") || "Not specified"}</p>
    {resource.complexityFlag && <p className="flag">{resource.complexityFlag}</p>}
  </>;
}
