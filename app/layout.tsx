import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "메딕차트",
  description: "메딕차트 — 학원 시험·정답·채점·계정 관리",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
