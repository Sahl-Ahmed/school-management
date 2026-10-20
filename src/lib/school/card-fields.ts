/**
 * The one list of fields a student ID card may carry.
 *
 * This exists because the printed card and the public QR page drifted apart.
 * Phase 6 wrote `guardian_phone` into the card snapshot and printed it on the
 * card, while the page looked for a key called `contact_phone` that nothing
 * ever wrote — so the number was silently dropped from the page. Nobody could
 * see that from either file alone.
 *
 * The owner has since settled the rule: **the public page shows the same
 * student details the card prints.** If a contact number is printed, it is
 * visible to anyone who scans; if it is not printed, it is nowhere. That is a
 * deliberate choice about one field, not a general licence, and what may be in
 * a snapshot at all is still bounded by the trigger on `qr_tokens` — which
 * refuses parent names, NIDs, birth certificate numbers, fees, marks and
 * attendance however carelessly a template is configured.
 *
 * So: a template declares which of these a card prints, the PDF prints exactly
 * those, and the page renders exactly those. One list, three consumers, and a
 * test that a printed field cannot be missing from the page.
 *
 * Deliberately free of server-only imports: the page, the PDF generator and
 * the tests must all agree on one definition, and a definition duplicated in a
 * test keeps passing after the real one changes.
 */

/** A field the card and the public page can both show. */
export type CardFieldKey =
  | "full_name"
  | "full_name_bn"
  | "registration_no"
  | "roll_no"
  | "class_name"
  | "section_name"
  | "blood_group"
  | "session"
  | "guardian_phone";

export type CardFieldSpec = {
  key: CardFieldKey;
  /** The label the public page prints beside the value. */
  label: string;
  /** Rendered in a tabular figure face: numbers that want aligning. */
  numeric?: boolean;
  /**
   * The name carries the heading on the page rather than a label, so it is
   * laid out separately from the label/value grid.
   */
  heading?: boolean;
};

/**
 * Every field, in the order the public page shows them.
 *
 * `photo` is not here: the page shows no photograph. The card prints one, but
 * publishing a child's face to anyone who scans a found card is a different
 * decision from publishing their class, and the owner has not asked for it.
 * `photo_path` in a snapshot is a Storage path for the PDF generator to read,
 * not something the page resolves.
 */
export const CARD_FIELDS: CardFieldSpec[] = [
  { key: "full_name", label: "Name", heading: true },
  { key: "full_name_bn", label: "নাম", heading: true },
  { key: "registration_no", label: "Registration No", numeric: true },
  { key: "roll_no", label: "Roll", numeric: true },
  { key: "class_name", label: "Class" },
  { key: "section_name", label: "Section" },
  { key: "blood_group", label: "Blood Group" },
  { key: "session", label: "Session" },
  { key: "guardian_phone", label: "Contact", numeric: true },
];

/**
 * Template field names that are NOT student details, so the page is not
 * expected to render them.
 *
 * `photo` is a picture the card prints; the back-of-card names are school
 * details the page already shows in its footer.
 */
export const NON_DETAIL_FIELDS = new Set([
  "photo",
  "school_address",
  "office_phone",
  "return_note",
]);

const BY_KEY = new Map(CARD_FIELDS.map((f) => [f.key as string, f]));

/** The spec for one field name, or undefined when the page cannot show it. */
export function cardField(key: string): CardFieldSpec | undefined {
  return BY_KEY.get(key);
}

export type SnapshotValue = string | number | null | undefined;

/**
 * The fields to render for one snapshot, in page order.
 *
 * Only keys the snapshot actually carries appear, so a card configured without
 * a blood group simply has no blood group line — the page never prints an
 * empty label. A key the snapshot carries but this list does not know is
 * ignored rather than rendered blindly, which is what keeps `photo_path` out.
 */
export function publicCardFields(
  snapshot: Record<string, SnapshotValue>,
): { key: CardFieldKey; label: string; value: string; numeric: boolean; heading: boolean }[] {
  return CARD_FIELDS.flatMap((spec) => {
    const raw = snapshot[spec.key];
    if (raw === null || raw === undefined || raw === "") return [];
    return [{
      key: spec.key,
      label: spec.label,
      value: String(raw),
      numeric: Boolean(spec.numeric),
      heading: Boolean(spec.heading),
    }];
  });
}

/**
 * Which of a template's printed fields the public page cannot show.
 *
 * Used by the tests, and worth keeping callable: it answers the question that
 * went unasked in phase 6 — "is there a field we print but do not publish?" —
 * so the answer can be asserted rather than assumed.
 */
export function unpublishableFields(printedFields: string[]): string[] {
  return printedFields.filter(
    (field) => !NON_DETAIL_FIELDS.has(field) && !BY_KEY.has(field),
  );
}
