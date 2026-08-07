import type { Metadata } from "next";
import { Inter, Archivo } from "next/font/google";
import SessionRoleSync from "@/app/components/SessionRoleSync";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const archivo = Archivo({
  variable: "--font-heading",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "TenantVoice — Property services, finally on your terms",
  description:
    "Browse verified inspectors, agents, tradies and accountants. Fixed prices, instant booking, and reviews from real property owners.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${archivo.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SessionRoleSync />
        {children}
      </body>
    </html>
  );
}
