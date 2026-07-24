import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "在途 · 旅行开销与日程",
  description: "旅行途中随手记账、实时预算和日程回看。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "在途 · 边走，边记。",
    description: "旅行途中随手记账、实时预算和日程回看。",
    images: [{ url: "/og.png", width: 1736, height: 909, alt: "在途旅行开销与日程" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "在途 · 边走，边记。",
    description: "旅行途中随手记账、实时预算和日程回看。",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
