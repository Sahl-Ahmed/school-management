/**
 * Stub for the `server-only` package under Vitest.
 *
 * The real package throws unless the bundler resolves it with the
 * "react-server" condition, which is how Next guarantees a module never
 * reaches a client bundle. Vitest resolves neither condition, so importing a
 * server module in a test would throw on the guard itself rather than on
 * anything the test cares about.
 *
 * Aliasing it to this empty module keeps the guard effective where it matters
 * (the Next build) while letting tests import server code directly. It does NOT
 * weaken the protection: Next still resolves the real package.
 */
export {};
