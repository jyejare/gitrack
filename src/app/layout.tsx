import type { Metadata } from "next";
import "./globals.css";
import { AiModeProvider } from "@/components/AiModeContext";
import { AdvancedUiProvider } from "@/components/AdvancedUiContext";
import { ThemeProvider } from "@/components/ThemeContext";

export const metadata: Metadata = {
  title: "giTrack",
  description: "PR readiness, checks, and AI-assisted reviews for your repos.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen">
        <ThemeProvider>
          <AiModeProvider>
            <AdvancedUiProvider>
              <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">{children}</div>
            </AdvancedUiProvider>
          </AiModeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
