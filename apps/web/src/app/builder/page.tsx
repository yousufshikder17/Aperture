import Link from "next/link";
import { api } from "@/lib/api";

interface VersionRow {
  version: number;
  createdAt: string;
  profileStrength: number | null;
  avgMatchScore: number | null;
  avgAtsScore: number | null;
}

export default async function Builder() {
  let versions: VersionRow[] = [];
  try {
    versions = await api<VersionRow[]>("/builder/versions");
  } catch {
    // Empty state when the API is not running.
  }

  return (
    <>
      <h1>Resume builder</h1>
      <p className="muted">Create one structured profile for matching, gap analysis, and application tracking.</p>

      <h2>Import or build</h2>
      <div className="card">
        Import a PDF or DOCX through <code>POST /v1/builder/upload</code>, review the extracted draft,
        or build the same structured profile manually. Save reviewed data through the Profile page.
      </div>

      <h2>Public analysis</h2>
      <div className="card">
        <ul>
          <li>Transparent job matching based on skills, experience, seniority, and location.</li>
          <li>Keyword coverage and lightweight skill-gap suggestions.</li>
          <li>Version history and profile PDF export.</li>
        </ul>
      </div>

      <h2>Version history</h2>
      {versions.length === 0 && (
        <div className="card muted">No versions yet — save your first resume on the <Link href="/profile">Profile</Link> page.</div>
      )}
      {versions.map((version) => (
        <div className="card" key={version.version}>
          <strong>v{version.version}</strong>{" "}
          <span className="muted">{version.createdAt.slice(0, 10)}</span>
          <div className="muted">
            strength: {version.profileStrength?.toFixed(0) ?? "pending"} · avg match: {version.avgMatchScore?.toFixed(0) ?? "—"} · avg ATS: {version.avgAtsScore?.toFixed(0) ?? "—"}
          </div>
        </div>
      ))}
    </>
  );
}
