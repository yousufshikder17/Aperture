import { api, ApiError } from "../../lib/server-api";
import "../builder/builder.css";

export default async function Account({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  let account: { id: string; email: string } | null = null;
  let unavailable = false;
  try {
    const result = await api<{ id: string; email: string }>("/auth/me");
    if (typeof result.id !== "string" || typeof result.email !== "string") throw new Error("Invalid account");
    account = result;
  } catch (cause) { unavailable = !(cause instanceof ApiError && cause.status === 401); }
  const development = process.env.NODE_ENV !== "production" && !process.env.WEB_OIDC_CLIENT_ID;
  return (
    <div className="resume-builder">
      <h1>Account</h1>
      {error && <p role="alert" className="builder-error">Sign-in could not be completed. Your previous session was not changed. Try signing in again.</p>}
      {unavailable && <p role="alert">Your account could not be checked. Retry when the API is available.</p>}
      {account ? <>
        <p>Signed in as {account.email}.</p>
        {development ? <p className="muted">Local development identity. Remove the configured development token to disable it.</p> :
          <form method="post" action="/auth/logout" className="builder-section">
            <button type="submit">Sign out of Aperture</button>
            <p className="muted">This ends the app session in this browser, not your identity provider session. Save any work before signing out.</p>
          </form>}
      </> : <p>You are not signed in to Aperture.</p>}
      <section className="builder-section">
        <h2>{account ? "Switch account" : "Sign in"}</h2>
        <p>Your identity provider handles your password. Aperture does not store it.</p>
        <a className="builder-link-button" href="/auth/login">Continue to sign in</a>
        <p className="muted">If sign-in is not configured, ask the deployment operator to configure OIDC. Expired sessions require signing in again.</p>
      </section>
      <a href="/builder">Return to the resume builder</a>
    </div>
  );
}
