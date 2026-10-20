/**
 * Rendering a notification template.
 *
 * Templates live in `notification_templates` as configuration, carrying
 * `{placeholder}` markers that are filled from a job's `payload`. Rendering
 * happens here rather than in SQL because the result has to be measured in
 * billable SMS segments, and that arithmetic already has one implementation in
 * ./segments.ts — a second one in SQL would eventually disagree with it.
 *
 * Deliberately free of server-only imports: the authority's template editor
 * previews a render in the browser, and the dispatcher renders on the server.
 * Both must produce the same string, so both use this.
 */

export type TemplateValues = Record<string, string | number | null | undefined>;

export type RenderResult = {
  body: string;
  /** Placeholders the template asked for that the payload did not supply. */
  missing: string[];
  /** Placeholders the payload supplied that the template never used. */
  unused: string[];
};

const PLACEHOLDER = /\{([a-z0-9_]+)\}/gi;

/**
 * Fills a template from a payload.
 *
 * An unknown placeholder is LEFT IN PLACE, as `{name}`, rather than replaced
 * with an empty string. A message reading "was {status} on 3 Nov" is obviously
 * broken and gets noticed in the preview; one reading "was  on 3 Nov" looks
 * almost right and goes out to four hundred guardians.
 */
export function renderTemplate(template: string, values: TemplateValues): RenderResult {
  const missing: string[] = [];
  const used = new Set<string>();

  const body = template.replace(PLACEHOLDER, (whole, name: string) => {
    const key = name.toLowerCase();
    used.add(key);

    const value = values[key];
    if (value === null || value === undefined || value === "") {
      missing.push(key);
      return whole;
    }
    return String(value);
  });

  const unused = Object.keys(values).filter(
    (key) => !used.has(key.toLowerCase()) && values[key] !== null && values[key] !== undefined,
  );

  return { body, missing, unused };
}

/** The placeholder names a template refers to, in order of first appearance. */
export function templatePlaceholders(template: string): string[] {
  const seen: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const key = match[1]!.toLowerCase();
    if (!seen.includes(key)) seen.push(key);
  }
  return seen;
}

/**
 * Sample values for previewing a template with no real job behind it.
 *
 * Obviously fake, so a preview can never be mistaken for a real message about
 * a real child.
 */
export const PREVIEW_VALUES: TemplateValues = {
  school: "SCH",
  student: "Demo Student",
  status: "present",
  date: "03 Nov 2026",
  present: 4,
  lessons: 5,
  exam: "Annual Examination",
  obtained: 412,
  max: 500,
  percentage: 82.4,
  gpa: "4.50",
  grade: "A",
  outcome: "Passed",
  test: "Chapter 3 test",
  subject: "Bangla",
  code: "123456",
  minutes: 10,
};
