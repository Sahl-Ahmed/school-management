/**
 * Photo upload and Storage access rules, against the REAL hosted project.
 *
 * Phase 1 defined the storage policies but never exercised them — the local
 * harness shims storage, so a policy bug there would have gone unnoticed. This
 * suite uploads real objects through real sessions and checks who can read
 * them.
 *
 * All images are generated here, in memory, as tiny valid files. No real
 * student photograph is involved.
 *
 * Skips entirely without credentials, so `npm test` stays offline.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { remoteCredentialStatus } from "./load-env.mjs";
import {
  syntheticStudentEmail,
  syntheticTeacherEmail,
} from "@/lib/auth/email-convention";

const status = remoteCredentialStatus();
const TEST_TAG = "phase2-storage";

/**
 * A minimal valid PNG: 1x1 pixel, ~70 bytes. Built as bytes rather than
 * compressed from a real photo so the test owns exactly what it uploads.
 */
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk" +
    "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** A PNG padded past 200 KB, to prove the bucket's own limit bites. */
function oversizedPng(): Buffer {
  return Buffer.concat([ONE_PIXEL_PNG, randomBytes(210 * 1024)]);
}

type Account = { userId: string; email: string; password: string };

let admin: SupabaseClient;
let url: string;
let anonKey: string;

const accounts: Record<string, Account> = {};
const SEED = {
  studentAlpha: "57000000-0000-4000-8000-000000000001",
  siblingElder: "57000000-0000-4000-8000-000000000003",
  teacherOne: "7eac0000-0000-4000-8000-000000000001",
};
const uploadedPaths: string[] = [];

function anonClient(): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function provision(
  email: string,
  role: "authority_admin" | "teacher" | "student",
  fullName: string,
  link?: { table: "students" | "teachers"; id: string },
): Promise<Account> {
  const password = `Vf-${randomBytes(18).toString("base64url")}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { created_by: TEST_TAG },
  });

  let userId: string;
  if (error) {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users.find((u) => u.email === email);
    if (!existing) throw new Error(`could not provision ${email}: ${error.message}`);
    userId = existing.id;
    await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
  } else {
    userId = data.user!.id;
  }

  await admin.from("profiles").upsert({
    id: userId,
    role,
    full_name: fullName,
    must_set_password: false,
    activated_at: new Date().toISOString(),
    is_active: true,
  });

  if (link) {
    await admin.from(link.table).update({ auth_user_id: userId }).eq("id", link.id);
  }

  return { userId, email, password };
}

async function signedInAs(who: Account): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email: who.email,
    password: who.password,
  });
  if (error) throw new Error(`sign-in failed for ${who.email}: ${error.message}`);
  return client;
}

describe.skipIf(!status.ready)("Storage on the hosted project", () => {
  beforeAll(async () => {
    url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    accounts.authority = await provision(
      `authority.${TEST_TAG}@school.invalid`,
      "authority_admin",
      "Storage Test Authority",
    );
    accounts.studentAlpha = await provision(
      syntheticStudentEmail(SEED.studentAlpha),
      "student",
      "Demo Student Alpha",
      { table: "students", id: SEED.studentAlpha },
    );
    accounts.siblingElder = await provision(
      syntheticStudentEmail(SEED.siblingElder),
      "student",
      "Demo Sibling Elder",
      { table: "students", id: SEED.siblingElder },
    );
    accounts.teacherOne = await provision(
      syntheticTeacherEmail(SEED.teacherOne),
      "teacher",
      "Demo Teacher One",
      { table: "teachers", id: SEED.teacherOne },
    );
  }, 180_000);

  afterAll(async () => {
    if (uploadedPaths.length) {
      await admin.storage.from("student-photos").remove(uploadedPaths);
    }
  });

  // -------------------------------------------------------------------------
  describe("buckets", () => {
    it("exist with the intended visibility and photo size limit", async () => {
      const { data, error } = await admin.storage.listBuckets();
      expect(error).toBeNull();

      const byId = Object.fromEntries((data ?? []).map((b) => [b.id, b]));

      expect(byId.branding?.public).toBe(true);
      expect(byId["student-photos"]?.public).toBe(false);
      expect(byId.documents?.public).toBe(false);

      // The 200 KB ceiling the brief requires, declared on the bucket itself.
      expect(byId["student-photos"]?.file_size_limit).toBe(204800);
    });
  });

  // -------------------------------------------------------------------------
  describe("uploading a student photo", () => {
    it("the authority can upload into a student's folder", async () => {
      const client = await signedInAs(accounts.authority!);
      const path = `${SEED.studentAlpha}/passport.png`;

      const { error } = await client.storage
        .from("student-photos")
        .upload(path, ONE_PIXEL_PNG, { contentType: "image/png", upsert: true });

      expect(error).toBeNull();
      uploadedPaths.push(path);

      // And the record can be linked, as the admission action does.
      const { error: linkError } = await client
        .from("students")
        .update({ photo_path: path, photo_bytes: ONE_PIXEL_PNG.byteLength })
        .eq("id", SEED.studentAlpha);

      expect(linkError).toBeNull();
    });

    it("the bucket refuses a file over 200 KB even from the authority", async () => {
      // This is the server-side guarantee behind the browser's compression. A
      // client that skipped compression must still be refused.
      const client = await signedInAs(accounts.authority!);
      const path = `${SEED.studentAlpha}/oversized.png`;

      const { error } = await client.storage
        .from("student-photos")
        .upload(path, oversizedPng(), { contentType: "image/png", upsert: true });

      expect(error).not.toBeNull();
      // Supabase reports this as a payload-too-large / size-limit error.
      expect(`${error!.message}`.toLowerCase()).toMatch(
        /exceeded|too large|maximum|size/,
      );
    });

    it("a student cannot upload a photo at all", async () => {
      const client = await signedInAs(accounts.studentAlpha!);

      const { error } = await client.storage
        .from("student-photos")
        .upload(`${SEED.studentAlpha}/self-uploaded.png`, ONE_PIXEL_PNG, {
          contentType: "image/png",
        });

      expect(error).not.toBeNull();
    });

    it("a teacher cannot upload a photo", async () => {
      const client = await signedInAs(accounts.teacherOne!);

      const { error } = await client.storage
        .from("student-photos")
        .upload(`${SEED.studentAlpha}/teacher-uploaded.png`, ONE_PIXEL_PNG, {
          contentType: "image/png",
        });

      expect(error).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe("reading a student photo", () => {
    const path = `${SEED.studentAlpha}/passport.png`;

    it("the student can read their own", async () => {
      const client = await signedInAs(accounts.studentAlpha!);
      const { data, error } = await client.storage.from("student-photos").download(path);

      expect(error).toBeNull();
      expect(data).not.toBeNull();
    });

    it("another student cannot read it", async () => {
      // The sibling is in a different class and is not this student.
      const client = await signedInAs(accounts.siblingElder!);
      const { data, error } = await client.storage.from("student-photos").download(path);

      expect(error ?? data === null).toBeTruthy();
      if (!error) expect(data).toBeNull();
    });

    it("a teacher who teaches the student can read it", async () => {
      // Teacher One teaches Bangla to Class 3, where Student Alpha sits.
      const client = await signedInAs(accounts.teacherOne!);
      const { data, error } = await client.storage.from("student-photos").download(path);

      expect(error).toBeNull();
      expect(data).not.toBeNull();
    });

    it("a teacher who does not teach the student cannot read it", async () => {
      // The elder sibling is in Class 8, which Teacher One does not teach.
      const otherPath = `${SEED.siblingElder}/passport.png`;
      await admin.storage
        .from("student-photos")
        .upload(otherPath, ONE_PIXEL_PNG, { contentType: "image/png", upsert: true });
      uploadedPaths.push(otherPath);

      const client = await signedInAs(accounts.teacherOne!);
      const { data, error } = await client.storage
        .from("student-photos")
        .download(otherPath);

      expect(error ?? data === null).toBeTruthy();
    });

    it("an anonymous visitor cannot read it, and cannot list the bucket", async () => {
      const client = anonClient();

      const { data: download, error: downloadError } = await client.storage
        .from("student-photos")
        .download(path);
      expect(downloadError ?? download === null).toBeTruthy();

      const { data: listed } = await client.storage.from("student-photos").list();
      expect(listed ?? []).toHaveLength(0);
    });

    it("the public URL of a private object does not serve the bytes", async () => {
      // getPublicUrl happily builds a URL for a private bucket; the point is
      // that fetching it is refused. A UI that used this URL would show a
      // broken image, not a leak.
      const { data } = admin.storage.from("student-photos").getPublicUrl(path);
      const response = await fetch(data.publicUrl);

      expect(response.ok).toBe(false);
      expect([400, 401, 403, 404]).toContain(response.status);
    });

    it("a signed URL does serve the bytes, and expires", async () => {
      // This is how the portal shows a photo: a short-lived signed URL made
      // server-side, not a public object.
      const { data, error } = await admin.storage
        .from("student-photos")
        .createSignedUrl(path, 60);

      expect(error).toBeNull();

      const response = await fetch(data!.signedUrl);
      expect(response.ok).toBe(true);
      expect(Number(response.headers.get("content-length"))).toBeGreaterThan(0);

      // A tampered token must not work.
      const tampered = data!.signedUrl.replace(/token=.*/, "token=not-a-real-token");
      const bad = await fetch(tampered);
      expect(bad.ok).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("the documents bucket", () => {
    it("a student can read only their own folder", async () => {
      const mine = `students/${SEED.studentAlpha}/${randomUUID()}.png`;
      const theirs = `students/${SEED.siblingElder}/${randomUUID()}.png`;

      await admin.storage.from("documents").upload(mine, ONE_PIXEL_PNG, {
        contentType: "image/png",
      });
      await admin.storage.from("documents").upload(theirs, ONE_PIXEL_PNG, {
        contentType: "image/png",
      });

      const client = await signedInAs(accounts.studentAlpha!);

      const ownFile = await client.storage.from("documents").download(mine);
      expect(ownFile.error).toBeNull();

      const otherFile = await client.storage.from("documents").download(theirs);
      expect(otherFile.error ?? otherFile.data === null).toBeTruthy();

      await admin.storage.from("documents").remove([mine, theirs]);
    });
  });

  // -------------------------------------------------------------------------
  describe("the branding bucket", () => {
    it("is readable by anyone, which is what the QR card page needs", async () => {
      const path = `${TEST_TAG}-logo.png`;
      await admin.storage.from("branding").upload(path, ONE_PIXEL_PNG, {
        contentType: "image/png",
        upsert: true,
      });

      const { data } = admin.storage.from("branding").getPublicUrl(path);
      const response = await fetch(data.publicUrl);

      expect(response.ok).toBe(true);

      await admin.storage.from("branding").remove([path]);
    });

    it("cannot be written by a student", async () => {
      const client = await signedInAs(accounts.studentAlpha!);
      const { error } = await client.storage
        .from("branding")
        .upload(`${TEST_TAG}-student-logo.png`, ONE_PIXEL_PNG, {
          contentType: "image/png",
        });

      expect(error).not.toBeNull();
    });
  });
});

if (!status.ready) {
  describe("Storage on the hosted project", () => {
    it.skip(`skipped — .env.local is missing: ${status.missing.join(", ")}`, () => {});
  });
}
