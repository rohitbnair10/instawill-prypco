import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "InstaWill — DIFC Will Service",
  description:
    "Assisted drafting for DIFC non-Muslim wills. Intake → structured draft → rules-engine validation → lawyer approval.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
