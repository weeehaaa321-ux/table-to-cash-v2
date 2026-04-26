import type { Metadata, Viewport } from "next";
import "../globals.css";

const SITE_URL = "https://tabletocash.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Table to Cash — The Operating System for Full-Service Restaurants",
    template: "%s · Table to Cash",
  },
  description:
    "Guest QR ordering, waiter tools, kitchen & bar routing, cashier rounds, and a live owner dashboard. One platform, zero chaos. Book a demo today.",
  keywords: [
    "restaurant POS",
    "QR code ordering",
    "restaurant management software",
    "kitchen display system",
    "table management",
    "hospitality software",
    "cashier system",
    "restaurant operations",
  ],
  authors: [{ name: "Table to Cash" }],
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: "Table to Cash — Restaurant Operating System",
    description:
      "One live system for guests, waiters, kitchen, bar, cashier, and owners. Built for full-service restaurants.",
    url: SITE_URL,
    siteName: "Table to Cash",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Table to Cash — Restaurant Operating System",
    description:
      "QR ordering, kitchen routing, cashier rounds, and a live dashboard — one platform.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f172a",
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Table to Cash",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description:
      "Restaurant operating system with QR ordering, waiter tools, kitchen routing, cashier rounds, and live analytics.",
    offers: {
      "@type": "Offer",
      price: "149",
      priceCurrency: "USD",
    },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "4.9",
      reviewCount: "37",
    },
  };

  return (
    <div className="bg-white text-text-primary antialiased [font-family:Inter,system-ui,sans-serif]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
      />
      {children}
    </div>
  );
}
