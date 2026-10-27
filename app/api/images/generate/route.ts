import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { GoogleGenAI, Modality } from "@google/genai";
import { AuthError, verifyRequest } from "@/lib/server/auth";
import type { ImageFolder } from "@/lib/images";

export const runtime = "nodejs";
// Gemini 3 + Google Search can take over a minute; 300s is the Hobby max with Fluid compute.
export const maxDuration = 300;

const ASPECT: Partial<Record<ImageFolder, string>> = { covers: "16:9", stops: "4:3", avatars: "1:1" };
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Generates an image with Gemini and stores it in Vercel Blob under the user's prefix. */
export async function POST(request: Request) {
  let uid: string;
  try {
    uid = (await verifyRequest(request)).uid;
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Please sign in again" }, { status: 401 });
    throw e;
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Image generation needs GEMINI_API_KEY" }, { status: 503 });

  const { prompt, folder } = (await request.json().catch(() => ({}))) as { prompt?: string; folder?: ImageFolder };
  const subject = prompt?.trim().slice(0, 500);
  if (!subject || !folder || !ASPECT[folder]) return NextResponse.json({ error: "prompt and folder are required" }, { status: 400 });

  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-lite-image",
      contents: folder === "avatars"
        ? `Friendly illustrated profile picture: ${subject}. Simple background, centered, no text.`
        : `Vivid, realistic travel photograph: ${subject}. Natural light, no text, no watermark, no logos.`,
      config: { responseModalities: [Modality.IMAGE], imageConfig: { aspectRatio: ASPECT[folder] } },
    });
    const image = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (!image?.data) {
      return NextResponse.json({ error: "Gemini couldn't create that image. Try describing it differently." }, { status: 422 });
    }
    const contentType = image.mimeType ?? "image/png";
    const blob = await put(`${uid}/${folder}/ai.${EXT[contentType] ?? "png"}`, Buffer.from(image.data, "base64"), {
      access: "public", contentType, addRandomSuffix: true,
    });
    return NextResponse.json({ url: blob.url });
  } catch (e) {
    console.error("[images/generate]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Image generation failed" }, { status: 500 });
  }
}
