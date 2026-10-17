// Tests run inside the Workers runtime with a local D1 database and R2, using the
// bindings from wrangler.jsonc. test/apply-migrations.js builds the schema
// from migrations/ before each test file.
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// A throwaway backup key for the tests, so the daily job's backup runs (and
// is tested) without the real key from wrangler.jsonc. 2048 bits: quick to
// make, and nothing it seals is kept.
const backupKeys = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey(
  { name: "RSA-OAEP", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
  true, ["encrypt", "decrypt"],
));
const { kty, n, e } = /** @type {JsonWebKey} */ (await crypto.subtle.exportKey("jwk", backupKeys.publicKey));
const TEST_BACKUP_PUBLIC_KEY = JSON.stringify({ kty, n, e, alg: "RSA-OAEP-256" });

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
          BACKUP_PUBLIC_KEY: TEST_BACKUP_PUBLIC_KEY,
        },
      },
    })),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.js"],
  },
});
