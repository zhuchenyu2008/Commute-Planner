import "./globals.css";
import type { Metadata } from "next";
import React from "react";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/project";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
