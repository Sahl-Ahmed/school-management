"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isHexColor, normaliseHex } from "@/lib/school/contrast";

/**
 * Library management.
 *
 * The card's background colour is stored; its text colour is not — that is
 * computed from the background at render time, which is what makes an
 * unreadable card impossible rather than merely discouraged. See
 * src/lib/school/contrast.ts.
 *
 * The audience is a RANGE of classes, because the specification's own example
 * is "Class 9–10" and a single class cannot say that. Start alone reads as one
 * class; neither set reads as "Everyone".
 */

export type LibraryState = {
  ok?: boolean;
  error?: string;
  notice?: string;
  fieldErrors?: Record<string, string[]>;
  seq?: number;
};

/**
 * Google Drive links only, and only ones that look like a shareable file.
 *
 * The brief's model is that the school puts a PDF on Drive and shares it
 * deliberately. Accepting any URL would let a private link into the catalogue
 * that every student then finds broken, so the host is checked — while the
 * message says what to paste rather than just refusing.
 */
const DRIVE_HOST = /^https:\/\/(drive|docs)\.google\.com\//i;

const bookSchema = z.object({
  title: z.string().trim().min(2, "Give the book its full title").max(300),
  title_bn: z.string().trim().max(300).optional(),
  author: z.string().trim().max(200).optional(),
  subject_label: z.string().trim().min(1, "Add a subject or short topic").max(60),
  description: z.string().trim().max(2000).optional(),
  class_id: z.string().optional(),
  class_to_id: z.string().optional(),
  card_color: z.string().trim().optional(),
  drive_url: z
    .string()
    .trim()
    .url("That is not a web address")
    .refine((url) => DRIVE_HOST.test(url), {
      message: "Paste the Google Drive share link for the PDF (drive.google.com or docs.google.com)",
    }),
  is_published: z.coerce.boolean().default(false),
});

export async function createBook(
  prev: LibraryState,
  formData: FormData,
): Promise<LibraryState> {
  const supabase = await createClient();

  const parsed = bookSchema.safeParse({
    title: formData.get("title"),
    title_bn: formData.get("title_bn") ?? undefined,
    author: formData.get("author") ?? undefined,
    subject_label: formData.get("subject_label"),
    description: formData.get("description") ?? undefined,
    class_id: formData.get("class_id") ?? undefined,
    class_to_id: formData.get("class_to_id") ?? undefined,
    card_color: formData.get("card_color") ?? undefined,
    drive_url: formData.get("drive_url"),
    is_published: formData.get("is_published") === "on",
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Please check the book's details.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const input = parsed.data;

  const colour = input.card_color && isHexColor(input.card_color)
    ? normaliseHex(input.card_color)
    : null;

  if (input.card_color && !colour) {
    return { error: "That colour is not a valid hex value, for example #1f6b45." };
  }

  // An end class with no start is meaningless; the database refuses it too, but
  // saying so here gives a better message than a constraint violation.
  if (input.class_to_id && !input.class_id) {
    return { error: "Choose the first class of the range, or leave both blank for everyone." };
  }

  const { error } = await supabase.from("library_books").insert({
    title: input.title,
    title_bn: input.title_bn || null,
    author: input.author || null,
    subject_label: input.subject_label,
    // `category` carried the subject before this column existed; keeping both
    // in step means older rows and new ones sort and filter the same way.
    category: input.subject_label,
    description: input.description || null,
    class_id: input.class_id || null,
    class_to_id: input.class_to_id || null,
    card_color: colour,
    drive_url: input.drive_url,
    is_published: input.is_published,
  });

  if (error) {
    if (error.message.includes("runs backwards")) {
      return { error: "The audience range runs backwards — the second class is below the first." };
    }
    if (error.message.includes("drive_url")) {
      return { error: "That link was refused. It must be an https address." };
    }
    if (error.message.includes("row-level security")) {
      return { error: "Only the school office can add a book." };
    }
    return { error: `Could not add the book: ${error.message}` };
  }

  revalidatePath("/authority/library");
  revalidatePath("/student/library");
  revalidatePath("/teacher/library");

  return {
    ok: true,
    seq: (prev.seq ?? 0) + 1,
    notice: input.is_published
      ? `"${input.title}" added and published — students and teachers can see it now.`
      : `"${input.title}" added as a draft. Publish it when you are ready.`,
  };
}

// ---------------------------------------------------------------------------
export async function setBookPublished(
  _prev: LibraryState,
  formData: FormData,
): Promise<LibraryState> {
  const supabase = await createClient();

  const bookId = String(formData.get("book_id") ?? "");
  const publish = formData.get("publish") === "true";

  if (!bookId) return { error: "No book was given." };

  const { error } = await supabase
    .from("library_books")
    .update({ is_published: publish })
    .eq("id", bookId);

  if (error) return { error: `Could not change it: ${error.message}` };

  revalidatePath("/authority/library");
  revalidatePath("/student/library");
  revalidatePath("/teacher/library");

  return {
    ok: true,
    notice: publish
      ? "Published. Students and teachers can see it now."
      : "Unpublished. It is hidden from students and teachers.",
  };
}

// ---------------------------------------------------------------------------
export async function setBookColour(
  _prev: LibraryState,
  formData: FormData,
): Promise<LibraryState> {
  const supabase = await createClient();

  const bookId = String(formData.get("book_id") ?? "");
  const raw = String(formData.get("card_color") ?? "");

  if (!bookId) return { error: "No book was given." };

  const colour = normaliseHex(raw);
  if (!colour) return { error: "That colour is not a valid hex value, for example #1f6b45." };

  const { error } = await supabase
    .from("library_books")
    .update({ card_color: colour })
    .eq("id", bookId);

  if (error) return { error: `Could not change the colour: ${error.message}` };

  revalidatePath("/authority/library");
  revalidatePath("/student/library");
  revalidatePath("/teacher/library");

  return { ok: true, notice: "Colour changed. The text colour follows automatically." };
}

// ---------------------------------------------------------------------------
/**
 * Records whether a book's Drive link still resolves.
 *
 * A HEAD request is enough and avoids pulling a whole PDF. Drive answers a
 * share link with a redirect, which `fetch` follows, so a 200 means the link
 * works for an anonymous visitor — which is exactly the question, since that is
 * what a student's browser is.
 *
 * A failure is RECORDED, not hidden: the catalogue shows "Link broken" rather
 * than offering a dead tab, and the office can see which books to fix.
 */
export async function checkBookLinks(
  _prev: LibraryState,
  formData: FormData,
): Promise<LibraryState> {
  const supabase = await createClient();

  const bookId = String(formData.get("book_id") ?? "");

  const query = supabase
    .from("library_books")
    .select("id, title, drive_url");

  const { data: books, error } = bookId
    ? await query.eq("id", bookId)
    : await query;

  if (error) return { error: `Could not read the catalogue: ${error.message}` };

  let ok = 0;
  let broken = 0;

  for (const book of books ?? []) {
    let reachable = false;
    try {
      const response = await fetch(book.drive_url, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
      });
      reachable = response.ok;
    } catch {
      reachable = false;
    }

    await supabase
      .from("library_books")
      .update({ link_ok: reachable, link_checked_at: new Date().toISOString() })
      .eq("id", book.id);

    if (reachable) ok += 1;
    else broken += 1;
  }

  revalidatePath("/authority/library");
  revalidatePath("/student/library");
  revalidatePath("/teacher/library");

  return {
    ok: true,
    notice:
      `Checked ${ok + broken} link${ok + broken === 1 ? "" : "s"}: ` +
      `${ok} working, ${broken} broken.` +
      (broken > 0 ? " A broken link shows as unavailable rather than opening a dead tab." : ""),
  };
}

// ---------------------------------------------------------------------------
export async function deleteBook(
  _prev: LibraryState,
  formData: FormData,
): Promise<LibraryState> {
  const supabase = await createClient();

  const bookId = String(formData.get("book_id") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!bookId) return { error: "No book was given." };
  if (confirm !== "DELETE") {
    return { error: "Type DELETE to confirm. Unpublishing hides a book without removing it." };
  }

  const { error } = await supabase.from("library_books").delete().eq("id", bookId);
  if (error) return { error: `Could not remove it: ${error.message}` };

  revalidatePath("/authority/library");
  revalidatePath("/student/library");
  revalidatePath("/teacher/library");

  return { ok: true, notice: "Removed from the catalogue." };
}
