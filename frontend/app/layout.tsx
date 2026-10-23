import type { Metadata } from "next";
import { Inter, Archivo } from "next/font/google";
import SessionExpiredNotice from "@/app/components/SessionExpiredNotice";
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
  title: { default: "TenantVoice — Property services, finally on your terms", template: "%s · TenantVoice" },
  description:
    "Browse verified inspectors, agents, tradies and accountants. Compare transparent service prices, request a booking, and read reviews from clients.",
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
        <SessionExpiredNotice />
        {children}
      </body>
    </html>
  );
}
