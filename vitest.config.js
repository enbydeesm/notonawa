// Tests run inside the Workers runtime with a local D1 database, using the
// bindings from wrangler.jsonc. test/apply-migrations.js builds the schema
// from migrations/ before each test file.
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
          // Requests to http://localhost sign in as this user (see src/auth/user.js).
          DEV_USER_EMAIL: "me@example.com",
        },
      },
    })),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.js"],
  },
});
