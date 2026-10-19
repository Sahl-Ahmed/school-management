/**
 * Runs the Supabase CLI with credentials loaded from .env.local.
 *
 * Why this exists rather than `source .env.local && supabase ...`:
 * a database password containing $, backticks or quotes would be mangled by
 * the shell. Loading the file in Node and handing the values to the child
 * process as an environment object avoids shell interpolation entirely, and
 * keeps secrets off the command line where they would show up in process
 * listings and shell history.
 *
 * Usage:  node scripts/supabase-cli.mjs link
 *         node scripts/supabase-cli.mjs db push --include-seed
 */

import { spawn } from "node:child_process";
import { loadEnvLocal } from "../tests/load-env.mjs";

if (!loadEnvLocal()) {
  console.error("No .env.local found.");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/supabase-cli.mjs <supabase args...>");
  process.exit(1);
}

// `link` needs the project ref; supply it from the environment so the command
// line stays identical across projects.
if (args[0] === "link" && !args.includes("--project-ref")) {
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!ref) {
    console.error("SUPABASE_PROJECT_REF is not set in .env.local");
    process.exit(1);
  }
  args.push("--project-ref", ref);
}

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["--yes", "supabase@2.121.0", ...args],
  {
    stdio: "inherit",
    env: process.env,
    // npx on Windows is a shim that needs a shell to resolve.
    shell: process.platform === "win32",
  },
);

child.on("exit", (code) => process.exit(code ?? 1));
