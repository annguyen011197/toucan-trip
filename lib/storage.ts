import { upload } from "@vercel/blob/client";
import { firebaseAuth } from "./firebase";
import { supabase } from "./supabase";
import { IMAGE_TYPES, isBlobUrl, MAX_IMAGE_BYTES, type ImageFolder } from "./images";
import { uid as randomId } from "./util";

/**
 * User images. Uploads go to Vercel Blob for now (NEXT_PUBLIC_IMAGE_STORAGE=supabase switches back to the
 * Supabase Storage `media` bucket). Paths are always `{firebaseUid}/{folder}/…`; both backends enforce it.
 * Deleting works for either backend, based on the URL.
 */
const USE_SUPABASE = process.env.NEXT_PUBLIC_IMAGE_STORAGE === "supabase";
const BUCKET = "media";
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

async function authHeader() {
  const user = firebaseAuth().currentUser;
  if (!user) throw new Error("Please sign in again");
  return { Authorization: `Bearer ${await user.getIdToken()}` };
}

export async function uploadImage(userId: string, folder: ImageFolder, file: File): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error("Please choose a JPG, PNG, WebP or GIF image.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Images must be 5 MB or smaller.");
  const name = `${randomId()}.${EXT[file.type]}`;

  if (USE_SUPABASE) {
    const path = `${userId}/${folder}/${name}`;
    const bucket = supabase().storage.from(BUCKET);
    const { error } = await bucket.upload(path, file, { contentType: file.type, cacheControl: "31536000" });
    if (error) throw new Error(error.message);
    return bucket.getPublicUrl(path).data.publicUrl;
  }

  const blob = await upload(`${userId}/${folder}/${name}`, file, {
    access: "public", contentType: file.type, handleUploadUrl: "/api/images/upload", headers: await authHeader(),
  });
  return blob.url;
}

/** Gemini image → Vercel Blob. Returns the image URL. */
export async function generateImage(folder: ImageFolder, prompt: string): Promise<string> {
  const res = await fetch("/api/images/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ folder, prompt }),
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error ?? `Image generation failed (HTTP ${res.status})`);
  return data.url;
}

/** Deletes an image this app stored (Vercel Blob or Supabase Storage). Other URLs, e.g. Wikimedia, are ignored. */
export async function removeImage(url?: string) {
  if (!url) return;
  try {
    if (isBlobUrl(url)) {
      await fetch("/api/images", { method: "DELETE", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ url }) });
      return;
    }
    const path = url.split(`/storage/v1/object/public/${BUCKET}/`)[1];
    if (!path) return;
    const { error } = await supabase().storage.from(BUCKET).remove([decodeURIComponent(path)]);
    if (error) throw error;
  } catch (e) {
    console.error("[storage] remove", e);
  }
}
