/**
 * Wording shared by the notification screens and actions.
 *
 * In its own module, NOT in actions.ts, because every export of a `"use server"`
 * file is turned into a server-action reference by the bundler: a plain string
 * exported from there arrives at the client as a function proxy. Phase 6 shipped
 * that bug once (see src/app/authority/feedback/questions.ts) and it crashes the
 * screen on render rather than failing quietly.
 */

/**
 * The sentence that must appear wherever a message appears to have been sent.
 *
 * No provider is connected, by the owner's decision. The system renders, costs
 * and records messages so the whole workflow can be built and checked, and
 * sends nothing. An office that believed otherwise would think four hundred
 * guardians had been told their children's results.
 */
export const SIMULATION_NOTE =
  "SIMULATION — no SMS provider is connected, so nothing reached any phone. " +
  "Messages are rendered, costed and recorded so the workflow can be checked; " +
  "real delivery needs a provider account.";

/** Shown wherever the queue or the log is displayed. */
export const SIMULATION_BANNER =
  "SMS is not live. No provider is connected, so every message below was " +
  "rendered, costed and recorded without being sent — a simulated dispatch is " +
  "marked \u201cskipped\u201d, never \u201csent\u201d, so these figures never describe delivery " +
  "that did not happen. Connecting a provider later needs credentials, not a " +
  "rewrite.";
