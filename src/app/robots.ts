import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/marketing"],
        disallow: ["/api/", "/cashier", "/kitchen", "/bar", "/waiter", "/dashboard"],
      },
    ],
    sitemap: "https://tabletocash.app/sitemap.xml",
  };
}
