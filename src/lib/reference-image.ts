// Reference photos are re-encoded in the browser before they travel: a JPEG of at most
// 1000 px on the long side, which the proposal route accepts and session storage can hold.

export const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const MAX_REFERENCE_SIDE = 1000;

/** Draws a decoded image or video frame into a JPEG data URL of at most 1000 px. */
export function referenceJpeg(source: CanvasImageSource, width: number, height: number): string {
  if (!width || !height) throw new Error("This reference has no readable image.");
  const c = document.createElement("canvas"), scale = Math.min(1, MAX_REFERENCE_SIDE / Math.max(width, height));
  c.width = Math.round(width * scale);
  c.height = Math.round(height * scale);
  c.getContext("2d")!.drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}

/** Opens an image URL, or fails after ten seconds. */
export async function decodeImage(url: string): Promise<HTMLImageElement> {
  const i = new Image();
  i.src = url;
  await Promise.race([i.decode(), new Promise((_, reject) => setTimeout(() => reject(new Error("The image took too long to open.")), 10000))]);
  return i;
}

/** A PNG, JPEG or WebP photo as a reference JPEG; other types are refused with a plain reason. */
export async function photoReference(file: File): Promise<string> {
  if (!PHOTO_TYPES.includes(file.type)) throw new Error("Add a PNG, JPEG or WebP photo.");
  if (file.size > 25 * 1024 * 1024) throw new Error("Choose a photo smaller than 25 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = await decodeImage(url);
    return referenceJpeg(image, image.naturalWidth || image.width, image.naturalHeight || image.height);
  } catch (e) {
    throw new Error((e as Error).message || "That photo could not be opened. Try a PNG or JPEG.");
  } finally { URL.revokeObjectURL(url); }
}
