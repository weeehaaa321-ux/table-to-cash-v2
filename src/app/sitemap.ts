import type { MetadataRoute } from "next";

const BASE = "https://tabletocash.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: `${BASE}/marketing`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
