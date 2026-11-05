import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", axes: ["SOFT", "WONK", "opsz"] });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "PARTART — break things into parts",
  description: "Upload anything. Explore how it can be made. Break it into parts. Build it in real life.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <header className="sticky top-0 z-40 border-b-2 border-ink bg-paper/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-6 px-5 py-3">
            <Link href="/" className="riso text-2xl font-black tracking-tight">
              PART<span className="text-tomato">ART</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm font-semibold">
              <Link className="rounded-full px-3 py-1.5 hover:bg-paper-2" href="/create">Create</Link>
              <Link className="rounded-full px-3 py-1.5 hover:bg-paper-2" href="/projects">Projects</Link>
            </nav>
            <span className="ml-auto hidden text-xs text-ink-soft md:block">Upload → Understand → Design → Deconstruct → Manufacture → Assemble</span>
          </div>
        </header>
        {children}
        <footer className="mt-24 border-t-2 border-ink">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-5 py-6 text-xs text-ink-soft">
            <span className="riso text-base font-bold text-ink">PARTART</span>
            <span>Break things into parts. Make something extraordinary.</span>
            <span className="ml-auto">Geometry checks are not structural engineering. Always test-cut and test-print.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
