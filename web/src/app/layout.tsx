import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const sans = Geist({ variable: "--font-app-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-app-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "SupplyRight — Hak Pasokan Digital", template: "%s · SupplyRight" },
  description:
    "Turning Supply Commitments into Enforceable Digital Rights. Platform B2B untuk tokenisasi hak pasokan, proteksi berdana, dan settlement klaim atomik di Ethereum Sepolia.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body className={`${sans.variable} ${mono.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
