import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata = {
  metadataBase: new URL("https://lol-statistics.local"),
  title: { default: "LoL Statistics", template: "%s · LoL Statistics" },
  description: "Published League of Legends champion statistics for TR1 Emerald+ Ranked Solo."
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="tr">
      <body>
        <header className="site-nav"><Link href="/" className="site-brand">LoL Statistics</Link><nav aria-label="Primary"><Link href="/">Home</Link><Link href="/methodology">Methodology</Link><Link href="/status">Status</Link></nav></header>
        {children}
        <footer className="site-footer"><p>This product is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.</p></footer>
      </body>
    </html>
  );
}
