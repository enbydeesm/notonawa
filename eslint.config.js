// Lint rules: ESLint's recommended set, with the right globals for each part
// of the app (Worker, browser pages, Node tooling).
import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

// The API paths of journal data (and "/api/" followed by a variable).
const JOURNAL = "/^\\/api\\/(ties|plans|people|locations|workshops|tags|stats|media|drawings|poses|pose-presets|visuals|connections|data|account\\/settings|sync|records|files|identity|convert)\\b|^\\/api\\/$/";

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
  // The service worker, for push notifications.
  { files: ["public/sw.js"], languageOptions: { globals: globals.serviceworker } },
  // Every read and write of journal data goes through the store
  // (public/js/store/), never api() directly, so the encrypted version can
  // replace it underneath without the pages changing. A path built from a
  // variable ("/api/${kind}") is refused too, as it can't be checked.
  {
    files: ["public/js/**/*.js"],
    ignores: ["public/js/store/**"],
    rules: {
      "no-restricted-syntax": ["error",
        ...[`CallExpression[callee.name="api"] > Literal.arguments[value=${JOURNAL}]`,
          `CallExpression[callee.name="api"] > TemplateLiteral.arguments > TemplateElement:first-child[value.raw=${JOURNAL}]`]
          .map((selector) => ({ selector, message: "Journal data goes through the store (public/js/store/index.js), not api()." }))],
    },
  },
  // Worker tests run inside the Workers runtime too.
  { files: ["test/**/*.js"], languageOptions: { globals: globals.serviceworker } },
  // Config files and scripts run in Node.
  { files: ["*.config.js", "scripts/**/*.mjs"], languageOptions: { globals: globals.node } },
]);
