import type { Metadata } from "next";

export const metadata: Metadata = {
  manifest: "/manifest-delivery.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Delivery" },
};

export default function DeliveryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
