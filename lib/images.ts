/** Shared by the browser and the /api/images routes. */
export const IMAGE_FOLDERS = ["covers", "avatars", "stops"] as const;
export type ImageFolder = (typeof IMAGE_FOLDERS)[number];

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** An image chosen for a trip cover, stop or avatar. `credit` is shown under photos that need attribution. */
export interface PickedImage {
  url: string;
  credit?: { text: string; url?: string };
}

export const AI_CREDIT = { text: "AI-generated with Gemini" };

export const isBlobUrl = (url: string) => {
  try { return new URL(url).hostname.endsWith(".public.blob.vercel-storage.com"); } catch { return false; }
};
