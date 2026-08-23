import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FPF Escudos",
  description: "Lê equipas de um PDF e procura os respetivos escudos na FPF."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt">
      <body>{children}</body>
    </html>
  );
}