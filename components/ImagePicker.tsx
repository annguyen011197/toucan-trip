"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImageUp, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { useApp } from "@/lib/app-state";
import { AI_CREDIT, IMAGE_TYPES, type ImageFolder, type PickedImage } from "@/lib/images";
import { generateImage, removeImage, uploadImage } from "@/lib/storage";
import { PrimaryButton, RemoteImage } from "./ui";
import { useI18n } from "@/lib/i18n-react";

type Busy = "upload" | "generate" | "save" | undefined;

/** Bottom sheet: upload a photo, or describe one and let Gemini generate it. */
export function ImagePicker({ title, folder, defaultPrompt, current, onPick, onClose }: {
  title: string;
  folder: ImageFolder;
  defaultPrompt: string;
  current?: string;
  onPick: (image: PickedImage | null) => Promise<void>;
  onClose: () => void;
}) {
  const { uid } = useApp();
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [preview, setPreview] = useState<string>(); // generated, not yet accepted
  const [busy, setBusy] = useState<Busy>();
  const [error, setError] = useState<string>();
  const previewRef = useRef<string>(undefined);
  previewRef.current = preview;
  // Kept apart from previewRef: saving re-renders this sheet, which would otherwise un-accept the image.
  const acceptedRef = useRef<string>(undefined);

  // A generated image the user never accepted is deleted when the sheet closes.
  useEffect(() => () => {
    const unused = previewRef.current;
    if (unused && unused !== acceptedRef.current) removeImage(unused);
  }, []);

  const run = async (kind: Busy, fn: () => Promise<void>) => {
    setBusy(kind); setError(undefined);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : t("common.somethingWrong")); } finally { setBusy(undefined); }
  };

  const pick = (image: PickedImage | null) => run("save", async () => {
    acceptedRef.current = image?.url;
    await onPick(image);
    onClose();
  });

  const onFile = (file?: File) => file && run("upload", async () => {
    const url = await uploadImage(uid, folder, file);
    await onPick({ url });
    onClose();
  });

  const generate = () => run("generate", async () => {
    const old = preview;
    setPreview(await generateImage(folder, prompt));
    if (old) removeImage(old);
  });

  // Portal + z above the TabBar (z-[1000]) so the bottom nav never covers the sheet.
  return createPortal(
    <div className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/40" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal aria-label={title} onClick={(e) => e.stopPropagation()}
        className="rise max-h-[90dvh] w-full max-w-[480px] space-y-4 overflow-y-auto overscroll-contain rounded-t-[28px] bg-white px-5 pt-4 pb-[max(20px,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-lg font-bold">{title}</h2>
          <button aria-label={t("common.close")} onClick={onClose} disabled={!!busy} className="flex h-9 w-9 items-center justify-center rounded-full bg-surface"><X className="h-4 w-4" /></button>
        </div>

        {(preview || current) && (
          <div className="relative">
            <RemoteImage src={preview ?? current} seed={preview ?? current} className="h-44 rounded-2xl" />
            {preview && <span className="absolute top-2.5 left-2.5 rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-bold tracking-wider text-primary uppercase backdrop-blur">{t("image.aiPreview")}</span>}
            {busy === "generate" && <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-white/60"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>}
          </div>
        )}

        {preview ? (
          <PrimaryButton onClick={() => pick({ url: preview, credit: AI_CREDIT })} disabled={!!busy}>
            {busy === "save" ? <Loader2 className="h-5 w-5 animate-spin" /> : t("image.use")}
          </PrimaryButton>
        ) : (
          <button onClick={() => fileRef.current?.click()} disabled={!!busy}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-line py-3.5 font-semibold disabled:opacity-60">
            {busy === "upload" ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImageUp className="h-5 w-5" />} {t("image.upload")}
          </button>
        )}
        <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(",")} hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />

        <div className="space-y-2.5 rounded-2xl bg-primary-soft/60 p-3.5">
          <label htmlFor="image-prompt" className="flex items-center gap-1.5 text-xs font-bold tracking-widest text-primary uppercase">
            <Sparkles className="h-3.5 w-3.5" /> {t("image.generateWithAi")}
          </label>
          <textarea id="image-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} maxLength={500}
            className="w-full resize-none rounded-xl bg-white px-3 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-primary/30" />
          <button onClick={generate} disabled={!!busy || !prompt.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 font-semibold text-white transition disabled:opacity-60">
            {busy === "generate" ? <><Loader2 className="h-5 w-5 animate-spin" /> {t("image.generating")}</> : <><Sparkles className="h-4 w-4" /> {preview ? t("image.tryAgain") : t("image.generate")}</>}
          </button>
        </div>

        {error && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        {current && !preview && (
          <button onClick={() => pick(null)} disabled={!!busy}
            className="flex w-full items-center justify-center gap-2 py-1 text-sm font-semibold text-red-600 disabled:opacity-60">
            <Trash2 className="h-4 w-4" /> {t("image.remove")}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
