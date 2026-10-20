import "server-only";

import QRCode from "qrcode";

/**
 * QR codes for the public card link.
 *
 * Rendered as a PNG buffer rather than an SVG, because pdf-lib embeds raster
 * images directly and has no SVG support; converting would mean shipping a
 * rasteriser for no benefit at this size.
 *
 * Error correction is set to M. A school ID card gets handled, scuffed and
 * carried in a pocket, so the lowest level would start failing to scan; the
 * highest would make the modules small enough at 20mm that a phone camera
 * struggles. M is the usual compromise for printed cards.
 */
export async function cardQrPng(url: string): Promise<Uint8Array> {
  const buffer = await QRCode.toBuffer(url, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    // Generated well above the printed size so the card's ~20mm square is
    // resampled down rather than up.
    width: 512,
    color: { dark: "#121712ff", light: "#ffffffff" },
  });
  return new Uint8Array(buffer);
}

/**
 * The absolute URL a card's QR points at.
 *
 * Built from NEXT_PUBLIC_SITE_URL because the code is printed on plastic: a
 * relative path or a localhost host would produce cards that work on the
 * office machine and nowhere else.
 */
export function cardUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/card/${token}`;
}
