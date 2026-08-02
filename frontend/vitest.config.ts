import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src"),
        },
    },
    test: {
        environment: "jsdom",
        globals: true,
        // No unit test files exist yet (only e2e/ Playwright specs, run separately
        // via `yarn test:e2e`) — don't fail CI until the suite is non-empty.
        passWithNoTests: true,
        exclude: [...configDefaults.exclude, "e2e/**"],
        coverage: {
            provider: "v8",
            reporter: ["text", "lcov"],
            reportsDirectory: "./coverage",
            include: ["src/**/*.{ts,tsx}"],
            exclude: [...configDefaults.exclude, "e2e/**", "src/**/*.d.ts"],
        },
    },
});
