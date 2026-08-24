/**
 * The parts of the photo pipeline that are pure arithmetic.
 *
 * Kept apart from `photos.ts` so they can be tested under Node without the
 * native image modules. Both have already been wrong once: the resize decision
 * capped the wrong edge and upscaled small images, and a base64 decoder is the
 * kind of thing that looks right and quietly corrupts every file.
 */

/** Full image and thumbnail targets. See the note in photos.ts for the why. */
export const FULL = { maxEdge: 1600, quality: 0.7 };
export const THUMB = { maxEdge: 400, quality: 0.6 };

/**
 * Which dimension to constrain, or null to leave the image alone.
 *
 * `resize` caps whichever dimension it is given, so the LONG edge has to be
 * chosen per image — capping width on a portrait photo leaves the height well
 * over target. And anything already inside the target is returned untouched:
 * scaling 800px up to 1600px invents no detail and multiplies the bytes.
 */
export function resizeTarget(
  source: { width: number; height: number },
  maxEdge: number,
): { width: number } | { height: number } | null {
  if (!(source.width > 0) || !(source.height > 0)) return null;
  if (Math.max(source.width, source.height) <= maxEdge) return null;
  return source.width >= source.height ? { width: maxEdge } : { height: maxEdge };
}

/**
 * base64 → bytes.
 *
 * Hand-rolled because React Native's fetch cannot reliably turn a `file://` URI
 * into a Blob, and `atob` is not dependable across the engines this runs on.
 * Decoding explicitly avoids both, and one more dependency.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  // Strip whitespace and padding; `=` carries no bits.
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let p = 0;

  for (let i = 0; i < clean.length; i++) {
    acc = (acc << 6) | alphabet.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, p);
}
