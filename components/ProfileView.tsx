"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/lib/app-state";
import { ALL_INTERESTS, BUDGET_LABEL, DIET_OPTIONS, type BudgetLevel, type Pace, type UserProfile } from "@/lib/types";
import { Chip, MascotAvatar, PrimaryButton } from "./ui";
import { cn } from "@/lib/util";

export function ProfileView() {
  const { profile, saveProfile, engine, storeKind } = useApp();
  const [draft, setDraft] = useState<UserProfile>(profile);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(profile), [profile]);

  const set = <K extends keyof UserProfile>(k: K, v: UserProfile[K]) => { setDraft((d) => ({ ...d, [k]: v })); setSaved(false); };
  const toggle = (i: string) => set("interests", draft.interests.includes(i) ? draft.interests.filter((x) => x !== i) : [...draft.interests, i]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile);

  return (
    <div className="space-y-5 px-5 pt-[max(16px,env(safe-area-inset-top))] pb-8">
      <h1 className="text-3xl font-bold">Profile</h1>

      <Section>
        <div className="flex items-center gap-3.5">
          <MascotAvatar size={56} />
          <div className="flex-1">
            <input value={draft.name} onChange={(e) => set("name", e.target.value)} aria-label="Your name" placeholder="Your name"
              className="w-full bg-transparent text-xl font-bold outline-none" />
            <div className="text-xs text-ink-2">Travel AI uses this to personalize your plans</div>
          </div>
        </div>
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

      <p className="text-center text-xs text-muted">
        Planner: {engine === "gemini" ? "Gemini" : "Offline demo"} · Data: {storeKind === "firebase" ? "Firestore" : "stored in this browser"}
      </p>
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
