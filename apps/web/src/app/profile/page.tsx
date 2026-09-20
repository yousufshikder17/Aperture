import { api } from "@/lib/server-api";
import type { MasterResume } from "@aperture/shared";

interface ProfileRow {
  masterResume: MasterResume | null;
  version: number;
}

export default async function Profile() {
  let profile: ProfileRow | null = null;
  try {
    profile = await api<ProfileRow>("/profile");
  } catch {
    // empty state
  }

  return (
    <>
      <h1>Master profile</h1>
      <p className="muted">
        Your saved master resume. Import a PDF or DOCX, review its extraction, or edit
        individual fields in the builder. Every save queues score recalculation.
      </p>
      <a href="/builder">Edit or import your resume</a>
      {!profile?.masterResume ? (
        <div className="card muted">
          No master resume yet. Open the builder to create or import one.
        </div>
      ) : (
        <>
          <div className="card">
            <strong>{profile.masterResume.basics.name}</strong>
            <div className="muted">
              v{profile.version} · {profile.masterResume.experience.length} roles ·{" "}
              {profile.masterResume.projects.length} projects ·{" "}
              {profile.masterResume.skills.length} skills
            </div>
            <div className="muted">
              Targeting: {profile.masterResume.targetRoles.join(", ") || "no target roles set"}
            </div>
          </div>
          <h2>Raw JSON</h2>
          <div className="card">
            <pre style={{ overflow: "auto", fontSize: "0.8rem" }}>
              {JSON.stringify(profile.masterResume, null, 2)}
            </pre>
          </div>
        </>
      )}
    </>
  );
}
