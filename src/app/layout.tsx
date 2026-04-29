import type { Metadata } from "next";
import "./globals.css";
import { AiModeProvider } from "@/components/AiModeContext";

export const metadata: Metadata = {
  title: "GitHub PR Insights",
  description: "PR readiness, checks, and on-demand Claude reviews for your org.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <AiModeProvider>
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">{children}</div>
        </AiModeProvider>
      </body>
    </html>
  );
}
