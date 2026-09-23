import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aperture Public — structured job search",
  description: "Structured resumes, transparent job matching, skill gaps, and application workflows.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          {/* Document navigation preserves native unsaved-draft warnings on Back/Forward. */}
          <a href="/">Aperture</a>
          <a href="/builder">Builder</a>
          <a href="/templates">Templates</a>
          <a href="/listings">Listings</a>
          <a href="/applications">Applications</a>
          <a href="/resources">Resources</a>
          <a href="/profile">Profile</a>
          <a href="/account">Account</a>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
