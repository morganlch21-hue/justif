import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Toaster } from "sonner";
import { BottomNav } from "@/components/BottomNav";
import { NavWrapper } from "@/components/NavWrapper";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Justif - Gestion des factures et tickets",
  description: "Automatisation comptable : factures, tickets restaurant, portail comptable",
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className={cn("min-h-screen bg-background font-sans antialiased", inter.variable)}>
        {children}
        <NavWrapper>
          <BottomNav />
        </NavWrapper>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
