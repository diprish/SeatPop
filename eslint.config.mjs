import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      ".llm-cache/**",
      ".llm-ledger/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: [
      "packages/*/src/**/*.ts",
      "packages/*/tests/**/*.ts",
      "worker/**/*.ts",
      "vitest.config.ts",
      "eslint.config.mjs",
    ],
    languageOptions: { globals: { ...globals.node } },
  },
);
