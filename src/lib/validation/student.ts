import { z } from "zod";
import { normaliseBdPhone } from "@/lib/phone";

/**
 * Admission form validation, shared by the browser and the server action.
 *
 * One schema, imported in both places, so the two cannot disagree. Client-side
 * validation here is a convenience that gives immediate feedback; the server
 * runs the same parse again and does not trust the client's verdict.
 *
 * Several rules are enforced a second time by the database (registration
 * number uniqueness, phone shape, at least one parent NID, roll uniqueness
 * within a section). That duplication is intentional: these messages explain
 * the rule, and the constraints guarantee it.
 */

export const BLOOD_GROUPS = [
  "A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-",
] as const;

export const GENDERS = ["male", "female", "other"] as const;

/** Accepts the shapes guardians actually write, stores one canonical form. */
const bdPhone = z
  .string()
  .trim()
  .min(1, "A guardian phone number is required")
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

/** Registration numbers appear in URLs, on cards and in login forms. */
const registrationNo = z
  .string()
  .trim()
  .min(3, "Registration number is too short")
  .max(64, "Registration number is too long")
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9/-]*$/,
    "Use letters, numbers, hyphens and slashes only",
  );

const nid = z
  .string()
  .trim()
  .regex(/^[0-9]{10,17}$|^$/, "A NID is 10 to 17 digits")
  .transform((v) => (v === "" ? null : v));

/** Rejects a date of birth that is in the future or implausibly old. */
const dateOfBirth = z
  .string()
  .min(1, "Date of birth is required")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Enter a valid date")
  .refine((v) => new Date(v) <= new Date(), "Date of birth cannot be in the future")
  .refine(
    (v) => new Date(v) >= new Date("1990-01-01"),
    "Check the date of birth — it looks too far in the past",
  );

export const studentAdmissionSchema = z
  .object({
    full_name: z.string().trim().min(2, "Full name is required").max(120),
    full_name_bn: z.string().trim().max(120).optional().default(""),
    gender: z.enum(GENDERS, { message: "Select a gender" }),
    date_of_birth: dateOfBirth,
    blood_group: z.enum(BLOOD_GROUPS).optional().or(z.literal("")),

    registration_no: registrationNo,
    roll_no: z.coerce
      .number({ message: "Roll number is required" })
      .int("Roll number must be a whole number")
      .positive("Roll number must be greater than zero")
      .max(100000),

    father_name: z.string().trim().min(2, "Father's name is required").max(120),
    mother_name: z.string().trim().min(2, "Mother's name is required").max(120),

    guardian_phone: bdPhone,
    contact_holder_name: z.string().trim().max(120).optional().default(""),

    academic_year_id: z.uuid("Select an academic year"),
    section_id: z.uuid("Select a class and section"),

    father_nid: nid.optional().nullable().default(null),
    mother_nid: nid.optional().nullable().default(null),
    birth_certificate_no: z
      .string()
      .trim()
      .max(64)
      .optional()
      .default("")
      .transform((v) => (v === "" ? null : v)),

    admitted_on: z
      .string()
      .optional()
      .default("")
      .transform((v) => (v === "" ? null : v)),
  })
  // The brief requires at least one parent NID, with both optional. The
  // database enforces the same rule; this produces a readable message first.
  .refine(
    (data) => Boolean(data.father_nid) || Boolean(data.mother_nid),
    {
      message: "Enter at least one parent's NID — father's or mother's",
      path: ["father_nid"],
    },
  );

export type StudentAdmissionInput = z.input<typeof studentAdmissionSchema>;
export type StudentAdmission = z.output<typeof studentAdmissionSchema>;

/**
 * Photo constraints.
 *
 * The 200 KB ceiling comes from the brief. It is enforced in three places:
 * the browser compresses to fit it, the server action re-checks the received
 * bytes, and the storage bucket declares file_size_limit = 204800. The browser
 * check is for feedback; the other two are the guarantee.
 */
export const PHOTO_MAX_BYTES = 200 * 1024;
export const PHOTO_ACCEPTED_TYPES = ["image/jpeg", "image/webp", "image/png"] as const;

export const studentPhotoSchema = z
  .instanceof(File, { message: "Attach a passport-style photo" })
  .refine((f) => f.size > 0, "The photo file is empty")
  .refine(
    (f) => f.size <= PHOTO_MAX_BYTES,
    `The photo must be ${Math.round(PHOTO_MAX_BYTES / 1024)} KB or smaller after compression`,
  )
  .refine(
    (f) => (PHOTO_ACCEPTED_TYPES as readonly string[]).includes(f.type),
    "The photo must be a JPEG, WebP or PNG image",
  );
