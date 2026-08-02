import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          name: "node",
          environment: "node",
          include: ["apps/collector/**/*.test.ts", "packages/**/*.test.ts", "apps/web/**/*.test.ts"]
        }
      },
      {
        plugins: [react()],
        test: {
          name: "web",
          environment: "jsdom",
          include: ["apps/web/**/*.test.ts", "apps/web/**/*.test.tsx"],
          setupFiles: ["apps/web/tests/setup.ts"]
        }
      }
    ]
  }
});
