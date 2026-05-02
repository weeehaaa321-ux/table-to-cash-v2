import type { Metadata } from "next";

export const metadata: Metadata = {
  manifest: "/manifest-dashboard.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Owner" },
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
