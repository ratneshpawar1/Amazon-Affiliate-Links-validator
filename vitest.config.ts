import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
  test: {
    globals: true,
    // jsdom gives us DOMParser / Document so classify.ts can be exercised the
    // same way it runs in the offscreen document.
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
  },
});
