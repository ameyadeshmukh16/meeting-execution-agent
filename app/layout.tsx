import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meeting → Execution Agent",
  description:
    "Turn meeting decisions into accountable work, without losing the context behind them.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: browser extensions add attributes to <html> before React loads.
    <html lang="en" suppressHydrationWarning>
      <body>
        <div className="app-shell">
          <header className="app-header">
            <div className="header-container">
              <div className="brand-group">
                <Link href="/" className="brand-logo">
                  <span className="brand-icon">⚡</span>
                  <div className="brand-titles">
                    <span className="brand-name">Execution Agent</span>
                    <span className="brand-badge">Decision Continuity</span>
                  </div>
                </Link>
                <p className="brand-tagline">
                  Turn meeting decisions into accountable work, without losing the
                  context behind them.
                </p>
              </div>

              <nav className="app-nav" aria-label="Main Navigation">
                <Link href="/" className="nav-link">
                  Meeting
                </Link>
                <Link href="/decisions" className="nav-link">
                  Decisions
                </Link>
                <Link href="/digest" className="nav-link">
                  Digest
                </Link>
                <Link href="/deadlines" className="nav-link">
                  Deadlines
                </Link>
              </nav>
            </div>
          </header>

          <main className="main-viewport">{children}</main>
        </div>
      </body>
    </html>
  );
}
