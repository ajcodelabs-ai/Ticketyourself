import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

export default tseslint.config(
    {
        ignores: [
            "dist/**",
            "node_modules/**",
            "e2e/**",
            "coverage/**",
            "*.config.js",
            "*.config.cjs",
            // shadcn/ui vendored primitives — generated boilerplate, not hand-authored app code.
            "src/components/ui/**",
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    react.configs.flat.recommended,
    react.configs.flat["jsx-runtime"],
    {
        ...jsxA11y.flatConfigs.recommended,
        // Real a11y debt, but not a functional bug — surface it without blocking CI.
        rules: Object.fromEntries(
            Object.keys(jsxA11y.flatConfigs.recommended.rules).map((rule) => [rule, "warn"]),
        ),
    },
    {
        plugins: { "react-hooks": reactHooks },
        rules: reactHooks.configs["recommended-latest"].rules,
    },
    {
        languageOptions: {
            globals: { ...globals.browser, ...globals.es2021 },
        },
        settings: { react: { version: "detect" } },
        rules: {
            // Gradual typing (tsconfig has strict:false) — don't fight `any` yet.
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],
            "react/prop-types": "off",
            // Cosmetic (HTML entity pedantry), not a functional bug — don't block on it.
            "react/no-unescaped-entities": "warn",
            // `role` is also used as a plain app prop (e.g. <ProtectedRoute role="organizer">)
            // on non-DOM components — only validate it as an ARIA role on real DOM elements.
            "jsx-a11y/aria-role": ["warn", { ignoreNonDOM: true }],
        },
    },
);
