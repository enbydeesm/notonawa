// Bindings that only exist in tests (see vitest.config.js).
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}

// Files imported as text in tests (Vite's ?raw).
declare module "*?raw" {
  const text: string;
  export default text;
}

// Vite's import.meta.glob: the paths of the files matching a pattern, found
// when the test is built (test/unit/areas.test.js).
interface ImportMeta {
  glob(pattern: string | string[]): Record<string, () => Promise<unknown>>;
}
