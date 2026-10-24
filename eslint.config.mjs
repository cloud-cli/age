import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["node_modules/**", "server/**", "test-results/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.mjs", "**/*.mts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        Buffer: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        window: "readonly",
        document: "readonly",
        FormData: "readonly",
        EventTarget: "readonly",
        CustomEvent: "readonly",
        WebSocket: "readonly",
      },
    },
    rules: {
      curly: ["error", "all"],
    },
  },
  {
    files: ["**/*.mts"],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      "no-undef": "off",
    },
  },
];
