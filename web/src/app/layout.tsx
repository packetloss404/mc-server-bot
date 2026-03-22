import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Sidebar } from "@/components/Sidebar";
import { SocketProvider } from "@/components/SocketProvider";
import { ToastProvider } from "@/components/Toast";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DyoCraft Dashboard",
  description: "Live monitoring dashboard for DyoCraft AI bots",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="h-full flex bg-[#09090b]">
        <SocketProvider>
          <ToastProvider>
            <Sidebar />
            <main className="flex-1 overflow-y-auto min-h-screen">{children}</main>
          </ToastProvider>
        </SocketProvider>
      </body>
    </html>
  );
}
