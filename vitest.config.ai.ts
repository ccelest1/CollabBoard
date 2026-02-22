import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    name: "AI Agent Tests",
    include: ["tests/ai/**/*.test.ts"],
    globals: true,
    environment: "node",
    testTimeout: 60000,
    hookTimeout: 10000,
    reporters: ["verbose"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
