import type { Metadata } from "next";

// Per-role manifest. Without this, every PWA installed from any role
// page inherits the root manifest's start_url (= /menu?table=1...) and
// opens to the guest scan screen instead of the kitchen — which is
// what staff hit when they tapped "Add to Home Screen" from /kitchen.
export const metadata: Metadata = {
  manifest: "/manifest-kitchen.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Kitchen" },
};

export default function KitchenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
