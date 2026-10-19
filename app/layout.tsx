import type { Metadata, Viewport } from "next";
import { Work_Sans } from "next/font/google";
import "./globals.css";

const workSans = Work_Sans({
  subsets: ["latin", "latin-ext", "vietnamese"],
  variable: "--font-work-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Toucan Trip – AI Travel Planner",
  description: "Chat with a friendly toucan to plan your trip, day by day.",
  appleWebApp: { capable: true, title: "Toucan Trip", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f7f9fc",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={workSans.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
