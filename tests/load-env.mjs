/**
 * Minimal .env.local loader for the remote verification tests.
 *
 * Deliberately dependency-free and deliberately non-destructive: a variable
 * already present in the real environment always wins, so a CI secret is never
 * silently overridden by a stale local file.
 *
 * Values are never logged. The remote suite reads credentials from here and
 * prints only whether they were found.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Loads .env.local into process.env. Returns true if the file existed. */
export function loadEnvLocal(file = ".env.local") {
  const path = resolve(projectRoot, file);
  if (!existsSync(path)) return false;

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Strip one layer of matching quotes, as dotenv does.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = value;
  }

  return true;
}

/**
 * Reports which required credentials are present, without revealing any value.
 * Used to decide whether the remote suite runs or skips.
 */
export function remoteCredentialStatus() {
  loadEnvLocal();

  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];

  const missing = required.filter((k) => {
    const v = process.env[k];
    return !v || v.startsWith("YOUR_") || v.includes("YOUR_PROJECT_REF");
  });

  return { ready: missing.length === 0, missing };
}
