import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  metadataBase: new URL("https://lol-statistics.local"),
  title: { default: "LoL Statistics", template: "%s · LoL Statistics" },
  description: "Published League of Legends champion statistics for TR1 Emerald+ Ranked Solo."
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
