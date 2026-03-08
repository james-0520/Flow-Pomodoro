import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: [".test-dist/**", "dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text", "html"],
      include: [
        "types.ts",
        "utils/sessionTime.ts",
        "components/Button.tsx",
        "components/TimerDisplay.tsx",
        "services/dbService.ts",
        "services/logService.ts",
        "services/geminiService.ts",
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
