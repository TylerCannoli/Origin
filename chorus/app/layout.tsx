import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Chorus", template: "%s · Chorus" },
  description: "Turn a manuscript into a cast audiobook, read by the people you choose.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
