import { api } from "@/lib/api";
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
        The single source of truth. Upload a PDF (extracted via vision, reviewed by you) or
        edit the JSON directly. Every save recomputes your scores in the background.
      </p>
      {!profile?.masterResume ? (
        <div className="card muted">
          No master resume yet. POST a PDF to /v1/profile/upload, review the extraction, then
          PUT it to /v1/profile.
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
