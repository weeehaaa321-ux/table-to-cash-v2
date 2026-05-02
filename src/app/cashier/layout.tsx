import type { Metadata } from "next";

export const metadata: Metadata = {
  manifest: "/manifest-cashier.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Cashier" },
};

export default function CashierLayout({ children }: { children: React.ReactNode }) {
  return children;
}
