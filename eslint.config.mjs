import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  { ignores: [".next/**", "node_modules/**", "drizzle/**", "next-env.d.ts", "scripts/ui/**", "*.config.mjs"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // App Router loads fonts in layout.tsx; the rule targets the pages router.
      "@next/next/no-page-custom-font": "off",
    },
  },
];

export default config;
