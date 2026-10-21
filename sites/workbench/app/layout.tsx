import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Deeplake — Evidence workbench",
  description:
    "Inspect sources, resolve schema gaps and publish evidence-backed information.",
  robots: { index: false, follow: false },
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
