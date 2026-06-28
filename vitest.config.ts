import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const srcPath = fileURLToPath(new URL("./src", import.meta.url));
const appPath = fileURLToPath(new URL("./app", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"]
  },
  resolve: {
    alias: {
      "@": srcPath,
      "@app": appPath
    }
  }
});
