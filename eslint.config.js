// Lint rules: ESLint's recommended set, with the right globals for each part
// of the app (Worker, browser pages, Node tooling).
import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  { ignores: ["node_modules/", ".wrangler/", "backups/", "worker-configuration.d.ts", "public/js/vendor/"] },
  js.configs.recommended,
  {
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
    },
  },
  // The Worker runs in the Workers runtime (web-standard globals, no DOM).
  // FixedLengthStream is Cloudflare's own.
  { files: ["src/**/*.js"], languageOptions: { globals: { ...globals.serviceworker, FixedLengthStream: "readonly" } } },
  // Pages run in the browser.
  { files: ["public/**/*.js"], languageOptions: { globals: globals.browser } },
  // Worker tests run inside the Workers runtime too.
  { files: ["test/**/*.js"], languageOptions: { globals: globals.serviceworker } },
  // Config files and scripts run in Node.
  { files: ["*.config.js", "scripts/**/*.mjs"], languageOptions: { globals: globals.node } },
]);
