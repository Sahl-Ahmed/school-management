"use client";

import { useRef, useState } from "react";
import { compressPhoto, formatBytes, DEFAULT_MAX_BYTES } from "@/lib/image/compress";

/**
 * Passport photo picker with in-browser compression.
 *
 * The chosen file is compressed before it ever leaves the browser, and the
 * compressed result replaces the file input's contents via a DataTransfer, so
 * the form submits the small version rather than the original. Uploading a 4 MB
 * phone photo over a Bangladeshi mobile connection and having the server reject
 * it would waste the upload and the user's data allowance.
 *
 * The server re-checks the size regardless, and the storage bucket enforces the
 * same ceiling a third time. This is the convenience layer, not the guarantee.
 */

type Status =
  | { state: "empty" }
  | { state: "working" }
  | {
      state: "ready";
      bytes: number;
      originalBytes: number;
      width: number;
      height: number;
      previewUrl: string;
    }
  | { state: "error"; message: string };

export function PhotoInput({
  name = "photo",
  maxBytes = DEFAULT_MAX_BYTES,
  errors,
}: {
  name?: string;
  maxBytes?: number;
  errors?: Record<string, string[]>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ state: "empty" });

  const serverError = errors?.[name]?.[0];

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      setStatus({ state: "empty" });
      return;
    }

    setStatus({ state: "working" });

    try {
      const result = await compressPhoto(file, maxBytes);

      if (result.bytes > maxBytes) {
        setStatus({
          state: "error",
          message:
            `This photo could not be reduced below ${formatBytes(maxBytes)} ` +
            `(best was ${formatBytes(result.bytes)}). Try a photo with less background detail.`,
        });
        if (inputRef.current) inputRef.current.value = "";
        return;
      }

      // Replace the input's file list with the compressed version so the form
      // submits that and not the original.
      const transfer = new DataTransfer();
      transfer.items.add(result.file);
      if (inputRef.current) inputRef.current.files = transfer.files;

      setStatus({
        state: "ready",
        bytes: result.bytes,
        originalBytes: result.originalBytes,
        width: result.width,
        height: result.height,
        previewUrl: URL.createObjectURL(result.file),
      });
    } catch (error) {
      setStatus({
        state: "error",
        message: error instanceof Error ? error.message : "Could not read that image.",
      });
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="sm:col-span-2">
      <label htmlFor={name} className="mb-1.5 block text-sm font-medium">
        Passport-style photo
      </label>

      <div className="flex items-start gap-4">
        {status.state === "ready" && (
          /* eslint-disable-next-line @next/next/no-img-element --
             a blob: URL preview of a file compressed moments ago in this
             browser. next/image cannot optimise an object URL, and there is
             nothing to optimise: the bytes are already under 200 KB. */
          <img
            src={status.previewUrl}
            alt="Preview of the selected student photo"
            className="h-28 w-24 shrink-0 rounded-lg border object-cover"
            style={{ borderColor: "var(--line-hairline)" }}
          />
        )}

        <div className="min-w-0 flex-1">
          <input
            ref={inputRef}
            id={name}
            name={name}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleChange}
            aria-describedby={`${name}-status`}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0
                       file:px-3 file:py-2 file:text-sm file:font-medium"
          />

          <div id={`${name}-status`} className="mt-2 text-xs" aria-live="polite">
            {status.state === "empty" && (
              <span style={{ color: "var(--text-muted)" }}>
                Compressed in your browser to under {formatBytes(maxBytes)} before upload.
                Optional — a photo can be added later.
              </span>
            )}

            {status.state === "working" && (
              <span style={{ color: "var(--text-muted)" }}>Compressing…</span>
            )}

            {status.state === "ready" && (
              <span style={{ color: "var(--state-good)" }}>
                Ready: {formatBytes(status.bytes)} ({status.width}×{status.height})
                {status.originalBytes > status.bytes && (
                  <> — reduced from {formatBytes(status.originalBytes)}</>
                )}
              </span>
            )}

            {status.state === "error" && (
              <span role="alert" style={{ color: "var(--state-bad)" }}>
                {status.message}
              </span>
            )}
          </div>

          {serverError && status.state !== "error" && (
            <p className="mt-1 text-xs" role="alert" style={{ color: "var(--state-bad)" }}>
              {serverError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
