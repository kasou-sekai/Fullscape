import eslint from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactPlugin from "eslint-plugin-react";
import globals from "globals";

export default [
    {
        ignores: ["dist/**", "node_modules/**"],
    },
    {
        files: ["src/**/*.{ts,tsx}"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: "./tsconfig.json",
                sourceType: "module",
            },
            globals: {
                ...globals.browser,
                ...globals.node,
                Spicetify: "readonly",
            },
        },
        plugins: {
            "@typescript-eslint": tsPlugin,
            react: reactPlugin,
        },
        settings: {
            react: {
                version: "detect",
            },
        },
        rules: {
            ...eslint.configs.recommended.rules,
            ...tsPlugin.configs.recommended.rules,
            ...reactPlugin.configs.recommended.rules,
            "react/react-in-jsx-scope": "off",
            "react/jsx-no-undef": "off",
            "react/no-deprecated": "off",
            "react/prop-types": "off",
            "@typescript-eslint/no-non-null-assertion": "warn",
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/ban-ts-comment": [
                "warn",
                {
                    "ts-expect-error": "allow-with-description",
                    "ts-ignore": "allow-with-description",
                },
            ],
        },
    },
    {
        files: ["src/services/mousetrap-record.ts"],
        rules: {
            "@typescript-eslint/no-this-alias": "off",
        },
    },
];
