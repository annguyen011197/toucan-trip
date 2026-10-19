import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { AuthError, verifyRequest } from "@/lib/server/auth";
import { isBlobUrl } from "@/lib/images";

export const runtime = "nodejs";

/** Deletes one of the caller's own Vercel Blob images. */
export async function DELETE(request: Request) {
  let uid: string;
  try {
    uid = (await verifyRequest(request)).uid;
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Please sign in again" }, { status: 401 });
    throw e;
  }
  const { url } = (await request.json().catch(() => ({}))) as { url?: string };
  if (!url || !isBlobUrl(url) || !new URL(url).pathname.startsWith(`/${uid}/`)) {
    return NextResponse.json({ error: "Not your image" }, { status: 403 });
  }
  await del(url);
  return NextResponse.json({ ok: true });
}
