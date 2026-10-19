"use client";

import { CalendarDays, House, Map, MessageCircle, User } from "lucide-react";
import { useApp, type Tab } from "@/lib/app-state";
import { cn } from "@/lib/util";
import { useI18n } from "@/lib/i18n-react";
import type { MessageKey } from "@/lib/i18n";

const TABS: { id: Tab; label: MessageKey; Icon: typeof House }[] = [
  { id: "home", label: "tab.home", Icon: House },
  { id: "chat", label: "tab.chat", Icon: MessageCircle },
  { id: "itinerary", label: "tab.itinerary", Icon: CalendarDays },
  { id: "map", label: "tab.map", Icon: Map },
  { id: "profile", label: "tab.profile", Icon: User },
];

export function TabBar() {
  const { tab, setTab } = useApp();
  const { t } = useI18n();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-[1000] mx-auto max-w-[480px] border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="grid grid-cols-5">
        {TABS.map(({ id, label, Icon }) => {
          const active = tab === id;
          return (
            <li key={id}>
              <button onClick={() => setTab(id)} aria-current={active ? "page" : undefined}
                className={cn("flex h-[68px] w-full flex-col items-center justify-center gap-1 text-[11px] font-semibold tracking-wide uppercase transition",
                  active ? "text-primary" : "text-muted hover:text-ink-2")}>
                <Icon className="h-6 w-6" strokeWidth={active ? 2.4 : 2} fill={active && id !== "map" ? "currentColor" : "none"} fillOpacity={active ? 0.15 : 0} />
                {t(label)}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
