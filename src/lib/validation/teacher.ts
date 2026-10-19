import { z } from "zod";
import { normaliseBdPhone } from "@/lib/phone";
import { BLOOD_GROUPS, GENDERS } from "@/lib/validation/student";

/** Shared by the Add Teacher form and its server action. */

const bdPhone = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .transform((v, ctx) => {
      const normalised = normaliseBdPhone(v);
      if (!normalised) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a Bangladeshi mobile number, for example 01712345678",
        });
        return z.NEVER;
      }
      return normalised;
    });

const optionalBdPhone = z
  .string()
  .trim()
  .optional()
  .default("")
  .transform((v, ctx) => {
    if (v === "") return null;
    const normalised = normaliseBdPhone(v);
    if (!normalised) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a Bangladeshi mobile number, for example 01712345678",
      });
      return z.NEVER;
    }
    return normalised;
  });

export const teacherAssignmentSchema = z.object({
  section_id: z.uuid(),
  subject_id: z.uuid(),
  academic_year_id: z.uuid(),
  effective_from: z.string().optional().default(""),
});

export const teacherCreateSchema = z.object({
  employee_code: z
    .string()
    .trim()
    .min(2, "Employee code is required")
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9/-]*$/, "Use letters, numbers, hyphens and slashes only"),

  full_name: z.string().trim().min(2, "Full name is required").max(120),
  full_name_bn: z.string().trim().max(120).optional().default(""),
  gender: z.enum(GENDERS, { message: "Select a gender" }),
  blood_group: z.enum(BLOOD_GROUPS).optional().or(z.literal("")),

  father_name: z.string().trim().max(120).optional().default(""),
  mother_name: z.string().trim().max(120).optional().default(""),

  // This number receives the activation code and every password reset, so it
  // is required and must be reachable.
  personal_phone: bdPhone("Personal phone"),
  alternate_phone: optionalBdPhone,
  email: z.string().trim().email("Enter a valid email").or(z.literal("")).optional().default(""),

  nid: z
    .string()
    .trim()
    .min(1, "NID is required")
    .regex(/^[0-9]{10,17}$/, "A NID is 10 to 17 digits"),

  education: z.string().trim().max(200).optional().default(""),
  designation: z.string().trim().max(120).optional().default(""),
  joined_on: z
    .string()
    .optional()
    .default("")
    .transform((v) => (v === "" ? null : v)),

  assignments: z.array(teacherAssignmentSchema).max(40).optional().default([]),

  // Fingerprint terminal mapping. Entered AFTER enrolling fingers at the
  // device itself; no template is uploaded here, and the mapping alone
  // transmits no attendance.
  device_id: z.string().optional().default(""),
  device_user_id: z.string().trim().max(32).optional().default(""),
  enrolled_fingers: z.coerce
    .number()
    .int()
    .min(0, "Cannot be negative")
    .max(10, "A person has ten fingers")
    .optional()
    .default(0),
  device_notes: z.string().trim().max(300).optional().default(""),
});

export type TeacherCreateInput = z.input<typeof teacherCreateSchema>;
export type TeacherCreate = z.output<typeof teacherCreateSchema>;

/**
 * The brief asks for a minimum of three DISTINCT fingers per teacher, and notes
 * that scanning one finger three times is the terminal's enrollment procedure
 * for a single finger, not three fingers. Fewer than three is allowed but
 * flagged, because it is a setup-quality problem rather than invalid data.
 */
export const RECOMMENDED_FINGERS = 3;

export function fingerEnrollmentWarning(count: number): string | null {
  if (count === 0) return "No fingers enrolled yet on the terminal.";
  if (count < RECOMMENDED_FINGERS) {
    return `Only ${count} finger${count === 1 ? "" : "s"} enrolled. The recommended minimum is ${RECOMMENDED_FINGERS} different fingers.`;
  }
  return null;
}
