"use client";

import { useActionState, useState } from "react";
import {
  checkBookLinks,
  createBook,
  setBookColour,
  setBookPublished,
  type LibraryState,
} from "./actions";
import { Banner, Field, SelectField, SubmitButton } from "@/components/form";
import { BookCard, type BookCardData } from "@/components/book-card";
import {
  CARD_COLOR_PRESETS,
  DEFAULT_CARD_COLOR,
  readableOn,
} from "@/lib/school/contrast";

const initial: LibraryState = {};

export type ClassOption = { id: string; name: string; level_order: number };

/**
 * Adds a book, with a live preview of the card it will produce.
 *
 * The preview is the point of the colour picker: the office chooses a
 * background and immediately sees the card as a student will, including the
 * text colour the system derived and a warning if the colour had to be nudged
 * to stay readable. Choosing blind and discovering the result on the student's
 * screen is how unreadable cards get published.
 */
export function BookCreator({ classes }: { classes: ClassOption[] }) {
  const [state, action] = useActionState(createBook, initial);

  const [title, setTitle] = useState("");
  const [titleBn, setTitleBn] = useState("");
  const [author, setAuthor] = useState("");
  const [subject, setSubject] = useState("");
  const [classFrom, setClassFrom] = useState("");
  const [classTo, setClassTo] = useState("");
  const [colour, setColour] = useState(DEFAULT_CARD_COLOR);
  const [driveUrl, setDriveUrl] = useState("");
  const [publish, setPublish] = useState(true);
  const [clearedFor, setClearedFor] = useState(0);

  // React empties the visible boxes after a successful add; this empties the
  // state behind them to match, so the next submission cannot re-add the last
  // book. The same pattern as the exam subject form.
  if (state.ok && state.seq && state.seq !== clearedFor) {
    setClearedFor(state.seq);
    setTitle("");
    setTitleBn("");
    setAuthor("");
    setSubject("");
    setDriveUrl("");
  }

  const colours = readableOn(colour);

  // The audience label, built the same way the database builds it, so the
  // preview says what the card will say.
  const from = classes.find((c) => c.id === classFrom);
  const to = classes.find((c) => c.id === classTo);
  const audience = !from
    ? "Everyone"
    : !to || to.id === from.id
      ? from.name
      : from.name.startsWith("Class ") && to.name.startsWith("Class ")
        ? `Class ${from.name.slice(6)}–${to.name.slice(6)}`
        : `${from.name} – ${to.name}`;

  const preview: BookCardData = {
    id: "preview",
    title: title || "The book's full title goes here, and may run to three lines before it is shortened",
    title_bn: titleBn || null,
    author: author || null,
    subject_label: subject || "Subject",
    audience_label: audience,
    card_color: colour,
    drive_url: driveUrl || "#",
    link_ok: null,
  };

  return (
    <section
      style={{
        borderRadius: "var(--radius-card)",
        background: "var(--surface-raised)",
        border: "1px solid var(--line-on-white)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <header className="px-4 py-3" style={{ borderBottom: "1px solid var(--line-on-white)" }}>
        <h2 className="text-sm font-semibold">Add a book</h2>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
          Put the PDF on Google Drive, share it, then paste the link here.
        </p>
      </header>

      <div className="grid gap-6 p-4 lg:grid-cols-[1fr_260px]">
        <form action={action} className="space-y-4">
          {/* Every field is submitted from state, so a rejected submission
              keeps what was typed. */}
          <input type="hidden" name="title" value={title} />
          <input type="hidden" name="title_bn" value={titleBn} />
          <input type="hidden" name="author" value={author} />
          <input type="hidden" name="subject_label" value={subject} />
          <input type="hidden" name="class_id" value={classFrom} />
          <input type="hidden" name="class_to_id" value={classTo} />
          <input type="hidden" name="card_color" value={colour} />
          <input type="hidden" name="drive_url" value={driveUrl} />
          {publish && <input type="hidden" name="is_published" value="on" />}

          {state.ok && state.notice && <Banner tone="success">{state.notice}</Banner>}
          {state.error && <Banner tone="error">{state.error}</Banner>}

          <Field
            label="Full title"
            name="title_display"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            errors={state.fieldErrors}
            required
            placeholder="Essentials of Human Biology and Physiology, Volume II"
            hint="The whole title. Long ones shorten on the card but stay readable in full on hover."
          />

          <Field
            label="Title in Bangla"
            name="title_bn_display"
            value={titleBn}
            onChange={(e) => setTitleBn(e.target.value)}
            errors={state.fieldErrors}
            placeholder="বইয়ের নাম"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Subject or topic"
              name="subject_label_display"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              errors={state.fieldErrors}
              required
              placeholder="Biology"
              hint="Short. This is the big line on the card."
            />

            <Field
              label="Author"
              name="author_display"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              errors={state.fieldErrors}
              placeholder="Optional"
            />

            <SelectField
              label="For class — from"
              name="class_from_display"
              value={classFrom}
              onChange={(e) => {
                setClassFrom(e.target.value);
                if (!e.target.value) setClassTo("");
              }}
              errors={state.fieldErrors}
              hint="Leave blank for everyone."
            >
              <option value="">Everyone</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </SelectField>

            <SelectField
              label="— to"
              name="class_to_display"
              value={classTo}
              onChange={(e) => setClassTo(e.target.value)}
              disabled={!classFrom}
              errors={state.fieldErrors}
              hint={classFrom ? "Leave blank for a single class." : "Choose the first class first."}
            >
              <option value="">Single class only</option>
              {classes
                .filter((c) => {
                  const start = classes.find((x) => x.id === classFrom);
                  return start ? c.level_order >= start.level_order : false;
                })
                .map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
            </SelectField>
          </div>

          <Field
            label="Google Drive link"
            name="drive_url_display"
            type="url"
            value={driveUrl}
            onChange={(e) => setDriveUrl(e.target.value)}
            errors={state.fieldErrors}
            required
            placeholder="https://drive.google.com/file/d/…/view"
            hint="Share the file as 'Anyone with the link' first, or students will see it as broken."
          />

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Card colour</legend>
            <div className="flex flex-wrap gap-1.5">
              {CARD_COLOR_PRESETS.map((preset) => {
                const active = preset.value.toLowerCase() === colour.toLowerCase();
                return (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setColour(preset.value)}
                    aria-pressed={active}
                    title={preset.name}
                    className="h-8 w-8 rounded-lg"
                    style={{
                      background: preset.value,
                      border: active
                        ? "2px solid var(--text-primary)"
                        : "1px solid var(--line-on-white)",
                      outline: active ? "2px solid var(--surface-raised)" : "none",
                      outlineOffset: "-4px",
                    }}
                  >
                    <span className="sr-only">{preset.name}</span>
                  </button>
                );
              })}

              <label className="flex items-center gap-2 pl-2 text-xs">
                <span style={{ color: "var(--text-muted)" }}>Or pick</span>
                <input
                  type="color"
                  value={colour}
                  onChange={(e) => setColour(e.target.value)}
                  className="h-8 w-10 cursor-pointer rounded border"
                  style={{ borderColor: "var(--line-on-white)" }}
                  aria-label="Choose any card colour"
                />
              </label>
            </div>

            <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
              You pick the background; the system picks the text colour. Contrast
              is {colours.ratio}:1 with {colours.text === "#ffffff" ? "white" : "dark"} text.
            </p>

            {colours.background.toLowerCase() !== colour.toLowerCase() && (
              <p className="mt-1 text-xs" style={{ color: "var(--state-warn)" }}>
                That colour could not be read against either black or white, so
                the card uses {colours.background} instead — the nearest shade
                that stays legible.
              </p>
            )}
          </fieldset>

          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={publish}
              onChange={(e) => setPublish(e.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Publish straight away</span>
              <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                Unpublished books are visible to the office only.
              </span>
            </span>
          </label>

          <SubmitButton pendingLabel="Adding…">Add book</SubmitButton>
        </form>

        {/* The live preview, as a student will see it. */}
        <div>
          <p className="mb-2 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
            How the card will look
          </p>
          <BookCard book={preview} />
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
export function PublishToggle({
  bookId,
  isPublished,
}: {
  bookId: string;
  isPublished: boolean;
}) {
  const [state, action] = useActionState(setBookPublished, initial);

  return (
    <form action={action} className="inline">
      <input type="hidden" name="book_id" value={bookId} />
      <input type="hidden" name="publish" value={isPublished ? "false" : "true"} />
      <button
        type="submit"
        className="whitespace-nowrap text-xs font-medium underline"
        style={{ color: isPublished ? "var(--state-warn)" : "var(--accent)" }}
      >
        {isPublished ? "Unpublish" : "Publish"}
      </button>
      {state.error && (
        <span className="ml-2 text-xs" style={{ color: "var(--state-bad)" }}>{state.error}</span>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
export function ColourChanger({
  bookId,
  current,
}: {
  bookId: string;
  current: string | null;
}) {
  const [state, action] = useActionState(setBookColour, initial);
  const [open, setOpen] = useState(false);
  const [colour, setColour] = useState(current ?? DEFAULT_CARD_COLOR);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="whitespace-nowrap text-xs font-medium underline"
      >
        Colour
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="book_id" value={bookId} />
      <input type="hidden" name="card_color" value={colour} />

      {CARD_COLOR_PRESETS.slice(0, 8).map((preset) => (
        <button
          key={preset.value}
          type="button"
          onClick={() => setColour(preset.value)}
          title={preset.name}
          className="h-6 w-6 rounded"
          style={{
            background: preset.value,
            border: preset.value.toLowerCase() === colour.toLowerCase()
              ? "2px solid var(--text-primary)"
              : "1px solid var(--line-on-white)",
          }}
        >
          <span className="sr-only">{preset.name}</span>
        </button>
      ))}
      <input
        type="color"
        value={colour}
        onChange={(e) => setColour(e.target.value)}
        className="h-6 w-8 cursor-pointer rounded border"
        style={{ borderColor: "var(--line-on-white)" }}
        aria-label="Choose any card colour"
      />
      <button type="submit" className="text-xs font-medium underline">Save</button>
      {state.error && (
        <span className="text-xs" style={{ color: "var(--state-bad)" }}>{state.error}</span>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
export function LinkChecker({ bookCount }: { bookCount: number }) {
  const [state, action] = useActionState(checkBookLinks, initial);

  return (
    <form action={action} className="space-y-2">
      {state.ok && state.notice && <Banner tone="success">{state.notice}</Banner>}
      {state.error && <Banner tone="error">{state.error}</Banner>}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Checking…">
          Check all {bookCount} link{bookCount === 1 ? "" : "s"}
        </SubmitButton>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Asks Drive whether each link still opens for someone who is not signed
          in — which is what a student&apos;s browser is.
        </p>
      </div>
    </form>
  );
}
