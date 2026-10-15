// Tests run inside the Workers runtime with a local D1 database and R2, using the
// bindings from wrangler.jsonc. test/apply-migrations.js builds the schema
// from migrations/ before each test file.
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      // Never the real D1 or R2, even though wrangler.jsonc marks them remote.
      remoteBindings: false,
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
          // Tests call the Worker at http://localhost (see test/helpers.js).
          RP_ID: "localhost",
          ORIGIN: "http://localhost",
        },
      },
    })),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.js"],
  },
});
