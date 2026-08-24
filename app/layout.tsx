import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://classroom-webapp-2026.znr1.chatgpt.site"),
  title: "공주 달 관찰 탐험대",
  description: "공주시 초등학생을 위한 달 모양·관찰 시간 확인과 사진 기록 활동",
  robots: { index: false, follow: false, noarchive: true },
  openGraph: {
    title: "공주 달 관찰 탐험대",
    description: "달 모양을 살펴보고 관찰 사진을 기록해요",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "공주 달 관찰 탐험대",
    description: "달 모양을 살펴보고 관찰 사진을 기록해요",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
