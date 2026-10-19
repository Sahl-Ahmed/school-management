/**
 * Client-side passport-photo compression.
 *
 * The brief requires the stored photo to be under 200 KB while staying
 * visually acceptable. Both halves matter: shrinking until it fits is easy,
 * shrinking until it fits and still looks like the child is the actual job.
 *
 * Strategy, in order:
 *   1. Downscale to a passport-ish bounding box. A 4000px phone photo carries
 *      far more detail than a printed 300dpi ID card can show, and resolution
 *      is where almost all the bytes are.
 *   2. Encode as WebP, which is roughly 25-35% smaller than JPEG at equal
 *      quality, falling back to JPEG where WebP encoding is unavailable.
 *   3. Step quality down until it fits, stopping at a floor rather than
 *      continuing into mush.
 *   4. Only if the quality floor still does not fit, reduce dimensions and
 *      repeat. This order keeps sharpness for as long as possible.
 *
 * EXIF is dropped by the canvas round-trip, which also strips GPS coordinates
 * that phones attach to photos. For a child's photograph that is a feature.
 * Canvas does not apply EXIF orientation automatically, so orientation is
 * taken from createImageBitmap, which does.
 */

export const DEFAULT_MAX_BYTES = 200 * 1024;

/** Passport photos print at 2x2in or 35x45mm; 600x750 covers 300dpi at 35x45mm. */
const MAX_EDGE = 750;
const MIN_EDGE = 320;
const QUALITY_START = 0.86;
const QUALITY_FLOOR = 0.45;
const QUALITY_STEP = 0.07;

export type CompressionResult = {
  file: File;
  width: number;
  height: number;
  bytes: number;
  type: string;
  /** Attempts made, useful for explaining a surprising result in the UI. */
  passes: number;
  originalBytes: number;
};

function canEncode(type: string): boolean {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  return canvas.toDataURL(type).startsWith(`data:${type}`);
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Fits `source` inside a square bounding box, preserving aspect ratio. */
function fitWithin(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function compressPhoto(
  input: File,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<CompressionResult> {
  if (!input.type.startsWith("image/")) {
    throw new Error("That file is not an image.");
  }

  // createImageBitmap honours EXIF orientation; a plain <img> does not, which
  // is why portrait phone photos otherwise arrive rotated.
  const bitmap = await createImageBitmap(input, { imageOrientation: "from-image" });

  const preferred = canEncode("image/webp") ? "image/webp" : "image/jpeg";

  let edge = MAX_EDGE;
  let passes = 0;
  let best: { blob: Blob; width: number; height: number } | null = null;

  try {
    while (edge >= MIN_EDGE) {
      const { width, height } = fitWithin(bitmap.width, bitmap.height, edge);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not prepare the image for compression.");

      // Better downscaling than the default nearest-neighbour-ish path.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      // A white backdrop so a transparent PNG does not encode as black.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);

      for (let quality = QUALITY_START; quality >= QUALITY_FLOOR; quality -= QUALITY_STEP) {
        passes += 1;
        const blob = await toBlob(canvas, preferred, quality);
        if (!blob) continue;

        // Remember the smallest result seen, so a failure to fit still returns
        // the best effort rather than nothing.
        if (!best || blob.size < best.blob.size) {
          best = { blob, width, height };
        }

        if (blob.size <= maxBytes) {
          return {
            file: new File([blob], renameFor(input.name, preferred), {
              type: preferred,
              lastModified: Date.now(),
            }),
            width,
            height,
            bytes: blob.size,
            type: preferred,
            passes,
            originalBytes: input.size,
          };
        }
      }

      // Quality floor reached without fitting: reduce dimensions and retry.
      edge = Math.round(edge * 0.8);
    }
  } finally {
    bitmap.close();
  }

  // Everything was tried and nothing fit. Return the best attempt and let the
  // caller refuse it, rather than silently uploading something oversized.
  if (best) {
    return {
      file: new File([best.blob], renameFor(input.name, preferred), { type: preferred }),
      width: best.width,
      height: best.height,
      bytes: best.blob.size,
      type: preferred,
      passes,
      originalBytes: input.size,
    };
  }

  throw new Error("Could not compress this image. Try a different photo.");
}

function renameFor(original: string, type: string): string {
  const base = original.replace(/\.[^.]+$/, "") || "photo";
  const ext = type === "image/webp" ? "webp" : "jpg";
  // Keep the name predictable and free of anything path-like.
  const safe = base.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 40);
  return `${safe || "photo"}.${ext}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
