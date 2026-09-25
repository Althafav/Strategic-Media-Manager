import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import { Header } from "@/components/header";
import "./globals.css";

// One family at two widths: condensed for titles (see `display` in globals.css), normal for text.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

export const metadata: Metadata = {
  title: "Strategic Media Manager",
  description: "Browse, search and download event media",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <Header />
        <main className="flex-1 w-full max-w-[1600px] mx-auto px-4 sm:px-6 pb-28">{children}</main>
      </body>
    </html>
  );
}
