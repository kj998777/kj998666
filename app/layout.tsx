import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "학원 시험관리",
  description: "학원 시험·정답·채점·계정 관리",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
