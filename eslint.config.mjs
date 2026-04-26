import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ─── Layer boundary rules ───────────────────────────────────
// Enforces the architecture defined in docs/ARCHITECTURE.md.
// Uses the built-in `no-restricted-imports` rule rather than adding a
// new ESLint plugin, so package.json stays identical to the source repo.
const layerRule = (forbiddenPatterns, message) => ({
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: forbiddenPatterns.map((p) => ({ group: [p], message })),
      },
    ],
  },
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
  ]),
  // Domain: may import nothing outside itself.
  {
    files: ["src/domain/**/*.{ts,tsx}"],
    ...layerRule(
      [
        "@/application/**",
        "@/infrastructure/**",
        "@/presentation/**",
        "next/**",
        "react",
        "react/**",
        "@prisma/**",
        "next",
      ],
      "Domain layer must not import from application, infrastructure, presentation, or any framework. See docs/ARCHITECTURE.md.",
    ),
  },
  // Application: may import domain + own ports. No concrete infra, no framework.
  {
    files: ["src/application/**/*.{ts,tsx}"],
    ...layerRule(
      [
        "@/infrastructure/**",
        "@/presentation/**",
        "next/**",
        "react",
        "react/**",
        "@prisma/**",
        "next",
      ],
      "Application layer must not import concrete infrastructure or presentation. Talk to ports.",
    ),
  },
  // Infrastructure: may not import from presentation.
  {
    files: ["src/infrastructure/**/*.{ts,tsx}"],
    ...layerRule(
      ["@/presentation/**"],
      "Infrastructure must not import from presentation.",
    ),
  },
  // Presentation: may not directly import infrastructure (must go via application).
  // Includes both src/presentation/ and src/app/ — Next.js 16 forces routes at src/app/,
  // so it's treated as part of the presentation layer.
  {
    files: ["src/presentation/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
    ...layerRule(
      ["@/infrastructure/**"],
      "Presentation must call application use cases, not infrastructure directly.",
    ),
  },
]);

export default eslintConfig;
