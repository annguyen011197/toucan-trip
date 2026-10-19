"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, LogOut } from "lucide-react";
import { useApp } from "@/lib/app-state";
import { useAuth } from "@/lib/auth";
import { ALL_INTERESTS, BUDGET_LABEL, DIET_OPTIONS, type BudgetLevel, type Pace, type UserProfile } from "@/lib/types";
import { Chip, PrimaryButton } from "./ui";
import { cn } from "@/lib/util";

export function ProfileView() {
  const { profile, saveProfile, setAvatar, engine } = useApp();
  const { user, signOut } = useAuth();
  const [draft, setDraft] = useState<UserProfile>(profile);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(profile), [profile]);

  const set = <K extends keyof UserProfile>(k: K, v: UserProfile[K]) => { setDraft((d) => ({ ...d, [k]: v })); setSaved(false); };
  const toggle = (i: string) => set("interests", draft.interests.includes(i) ? draft.interests.filter((x) => x !== i) : [...draft.interests, i]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile);

  const onAvatar = async (file?: File) => {
    if (!file) return;
    setUploading(true); setUploadError(undefined);
    try { await setAvatar(file); } catch (e) { setUploadError(e instanceof Error ? e.message : "Upload failed"); } finally { setUploading(false); }
  };

  return (
    <div className="space-y-5 px-5 pt-[max(16px,env(safe-area-inset-top))] pb-8">
      <h1 className="text-3xl font-bold">Profile</h1>

      <Section>
        <div className="flex items-center gap-3.5">
          <button aria-label="Change photo" onClick={() => fileRef.current?.click()} disabled={uploading}
            className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full border-2 border-white bg-primary-soft shadow-sm">
            <img src={profile.avatarUrl ?? user?.photoURL ?? "/mascot-avatar.webp"} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
            <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white opacity-0 transition hover:opacity-100">
              <Camera className="h-5 w-5" />
            </span>
            {uploading && <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white"><Loader2 className="h-5 w-5 animate-spin" /></span>}
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden
            onChange={(e) => { onAvatar(e.target.files?.[0]); e.target.value = ""; }} />
          <div className="min-w-0 flex-1">
            <input value={draft.name} onChange={(e) => set("name", e.target.value)} aria-label="Your name" placeholder="Your name"
              className="w-full bg-transparent text-xl font-bold outline-none" />
            <div className="truncate text-xs text-ink-2">{user?.email ?? "Travel AI uses this to personalize your plans"}</div>
          </div>
        </div>
        {uploadError && <p role="alert" className="text-sm text-red-600">{uploadError}</p>}
      </Section>

      <Section title="Interests">
        <div className="flex flex-wrap gap-2">
          {ALL_INTERESTS.map((i) => <Chip key={i} highlighted={draft.interests.includes(i)} onClick={() => toggle(i)}>{i}</Chip>)}
        </div>
      </Section>

      <Section title="Travel style">
        <Row label="Budget level">
          <Segmented options={(Object.keys(BUDGET_LABEL) as BudgetLevel[]).map((b) => [b, BUDGET_LABEL[b]])} value={draft.budgetLevel} onChange={(v) => set("budgetLevel", v as BudgetLevel)} />
        </Row>
        <Row label="Pace">
          <Segmented options={[["relaxed", "Relaxed"], ["packed", "Packed"]]} value={draft.pace} onChange={(v) => set("pace", v as Pace)} />
        </Row>
        <Row label="Diet">
          <select value={draft.diet} onChange={(e) => set("diet", e.target.value)} className="rounded-xl bg-surface px-3 py-2 text-sm outline-none">
            {DIET_OPTIONS.map((d) => <option key={d}>{d}</option>)}
          </select>
        </Row>
        <Row label="Home airport">
          <input value={draft.homeAirport} maxLength={3} aria-label="Home airport"
            onChange={(e) => set("homeAirport", e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
            className="w-20 rounded-xl bg-surface px-3 py-2 text-center text-sm font-semibold tracking-widest outline-none" />
        </Row>
      </Section>

      <PrimaryButton disabled={!dirty && !saved} onClick={async () => { await saveProfile(draft); setSaved(true); }}>
        {saved && !dirty ? "Saved ✓" : "Save profile"}
      </PrimaryButton>

      <button onClick={() => signOut()} className="flex w-full items-center justify-center gap-2 rounded-full bg-white py-3.5 font-semibold text-ink-2 shadow-card">
        <LogOut className="h-4 w-4" /> Sign out
      </button>

      <p className="text-center text-xs text-muted">Planner: {engine === "gemini" ? "Gemini" : "Offline demo"}</p>
    </div>
  );
}

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card bg-white p-5 shadow-card">
      {title && <h2 className="mb-3.5 text-xs font-bold tracking-widest text-ink-2 uppercase">{title}</h2>}
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-[15px]">{label}</span>{children}</div>;
}

function Segmented({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex rounded-full bg-surface p-1">
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)}
          className={cn("rounded-full px-3 py-1.5 text-[13px] font-semibold transition", v === value ? "bg-white text-primary shadow-sm" : "text-ink-2")}>
          {l}
        </button>
      ))}
    </div>
  );
}
