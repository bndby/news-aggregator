import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "hono/jsx",
    },
  },
});
