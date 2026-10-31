import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Meeting Execution Agent",
  description: "Turn standup transcripts into confirmed, conflict-checked Trello tasks.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <nav>
          <strong>Meeting → Execution</strong>
          <Link href="/">Meeting</Link>
          <Link href="/decisions">Decisions</Link>
          <Link href="/digest">Digest</Link>
          <Link href="/deadlines">Deadlines</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
