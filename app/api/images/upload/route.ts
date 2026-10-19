import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { verifyRequest } from "@/lib/server/auth";
import { IMAGE_FOLDERS, IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/images";

export const runtime = "nodejs";

/**
 * Signs browser → Vercel Blob uploads (files never pass through this function, so the 4.5 MB body limit
 * doesn't apply). Only signed-in users, only into their own `{uid}/{folder}/` prefix, images only.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const user = await verifyRequest(request);
        const [owner, folder] = pathname.split("/");
        if (owner !== user.uid || !IMAGE_FOLDERS.includes(folder as never)) throw new Error("Not allowed to upload here");
        return { allowedContentTypes: IMAGE_TYPES, maximumSizeInBytes: MAX_IMAGE_BYTES, addRandomSuffix: true };
      },
    });
    return NextResponse.json(json);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 400 });
  }
}
