import type { Metadata } from "next";

export const metadata: Metadata = {
  manifest: "/manifest-waiter.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Waiter" },
};

export default function WaiterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
