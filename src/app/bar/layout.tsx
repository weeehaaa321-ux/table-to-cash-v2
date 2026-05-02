import type { Metadata } from "next";

export const metadata: Metadata = {
  manifest: "/manifest-bar.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Bar" },
};

export default function BarLayout({ children }: { children: React.ReactNode }) {
  return children;
}
