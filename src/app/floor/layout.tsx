import type { Metadata } from "next";

export const metadata: Metadata = {
  manifest: "/manifest-floor.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Floor" },
};

export default function FloorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
