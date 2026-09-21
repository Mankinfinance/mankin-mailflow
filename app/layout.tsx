import type { Metadata, Viewport } from "next";
import { Newsreader, Manrope, JetBrains_Mono } from "next/font/google";
import { PwaInstaller } from "@/components/PwaInstaller";
import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  // 800 (font-extrabold) dropped — unused anywhere in the app.
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "LoanFlow",
  description:
    "LoanFlow - broker dashboard and customer document portal for Mankin Finance.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "LoanFlow",
  },
};

/* PWA theme + colour scheme - keeps the iOS status bar + Android nav
   bar tinted to brand navy when LoanFlow is installed to the home
   screen, and prevents the dashboard from zooming on text-input focus. */
export const viewport: Viewport = {
  themeColor: "#1c2566",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en-AU"
      className={`${newsreader.variable} ${manrope.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <PwaInstaller />
      </body>
    </html>
  );
}
