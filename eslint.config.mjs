import coreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * eslint-config-next 16 ships native flat configs, so they are spread directly
 * rather than wrapped in FlatCompat (which cannot serialise them).
 */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "services/**/node_modules/**",
      "next-env.d.ts",
    ],
  },
  ...coreWebVitals,
  ...nextTypescript,
  {
    // The SQL harness and seed scripts are Node scripts, not app code.
    files: ["tests/**/*.mjs", "scripts/**/*.mjs"],
    rules: {
      "no-console": "off",
    },
  },
];

export default config;
