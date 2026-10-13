import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Fraunces } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Titres : serif douce (axe SOFT poussé). Interface : Atkinson, dessinée pour rester lisible
// à petite taille et faible contraste — on lit Murmure dans le noir.
const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["SOFT", "opsz"],
  display: "swap",
});
const body = Atkinson_Hyperlegible({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Murmure", template: "%s — Murmure" },
  description: "Tes cours, chuchotés.",
  applicationName: "Murmure",
  appleWebApp: { capable: true, title: "Murmure", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#14132b" },
    { media: "(prefers-color-scheme: light)", color: "#14132b" },
  ],
  viewportFit: "cover",
};

// Thème sombre par défaut ; le thème clair est un choix enregistré sur l'appareil.
const themeScript = `try{if(localStorage.getItem("murmure-theme")==="light")document.documentElement.classList.remove("dark")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="fr"
      className={`${display.variable} ${body.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
