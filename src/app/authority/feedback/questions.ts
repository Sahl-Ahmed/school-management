/**
 * Proposed feedback question wording, in English and Bangla.
 *
 * In its own module, NOT in actions.ts, because every export of a `"use server"`
 * file is turned into a server-action reference by the bundler. A plain array
 * exported from there reaches the client as a function proxy, and
 * `PROPOSED_QUESTIONS.map(...)` fails at render with "map is not a function" —
 * which is exactly what happened before this file existed.
 *
 * These are a starting point, not the owner's final questions: decision 6 in
 * docs/decisions-for-owner.md is still open on the exact phrasing. They are
 * offered as editable defaults in the create form, and whatever the school
 * settles on is stored per round, so a later round can ask something else.
 */
export const PROPOSED_QUESTIONS: { prompt: string; prompt_bn: string }[] = [
  {
    prompt: "Does this teacher explain the lesson clearly?",
    prompt_bn: "এই শিক্ষক কি পাঠ স্পষ্টভাবে বুঝিয়ে দেন?",
  },
  {
    prompt: "Can you ask this teacher questions comfortably?",
    prompt_bn: "আপনি কি এই শিক্ষককে সহজে প্রশ্ন করতে পারেন?",
  },
  {
    prompt: "Does this teacher start and finish the class on time?",
    prompt_bn: "এই শিক্ষক কি সময়মতো ক্লাস শুরু ও শেষ করেন?",
  },
];
