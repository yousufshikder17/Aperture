import type { Metadata } from "next";
import Link from "next/link";
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
          <Link href="/">Aperture</Link>
          <Link href="/builder">Builder</Link>
          <Link href="/listings">Listings</Link>
          <Link href="/applications">Applications</Link>
          <Link href="/resources">Resources</Link>
          <Link href="/profile">Profile</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
