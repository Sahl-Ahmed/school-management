import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // The authority can change the school name later; this is the working name
  // from the brief and is read from school_settings once branding is set up.
  title: {
    default: "School Management",
    template: "%s · School Management",
  },
  description: "Authority, teacher and student portals for a school in Bangladesh.",
  robots: {
    // Nothing here should be indexed: the portals are private, and the public
    // QR card page is meant to be reached by scanning a card, not by search.
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
