"use client";

import { AppProvider, useApp } from "@/lib/app-state";
import { AuthProvider, useAuth } from "@/lib/auth";
import { TabBar } from "@/components/TabBar";
import { HomeView } from "@/components/HomeView";
import { ChatView } from "@/components/ChatView";
import { ItineraryView } from "@/components/ItineraryView";
import { MapScreen } from "@/components/MapScreen";
import { ProfileView } from "@/components/ProfileView";
import { SignInView } from "@/components/SignInView";
import { NoTrip } from "@/components/ui";
import { I18nProvider, useI18n } from "@/lib/i18n-react";

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <img src="/mascot.webp" alt="" className="h-28 w-28 animate-pulse" />
    </div>
  );
}

function Screen() {
  const { ready, tab, selectedTrip, startNewTrip, setTab, isOwner } = useApp();
  const { t } = useI18n();
  if (!ready) return <Splash />;
  switch (tab) {
    case "home":
      return <HomeView />;
    case "chat":
      // Planning chat is the owner's; people a trip is shared with comment on the itinerary instead.
      if (selectedTrip && !isOwner(selectedTrip)) {
        return <NoTrip title={t("empty.sharedChat.title")} message={t("empty.sharedChat.message")}
          action={t("empty.sharedChat.action")} onStart={() => setTab("itinerary")} />;
      }
      return selectedTrip ? <ChatView key={selectedTrip.id} tripId={selectedTrip.id} />
        : <NoTrip title={t("empty.chat.title")} message={t("empty.chat.message")} onStart={() => startNewTrip()} />;
    case "itinerary":
      return selectedTrip ? <ItineraryView trip={selectedTrip} />
        : <NoTrip title={t("empty.itinerary.title")} message={t("empty.itinerary.message")} onStart={() => startNewTrip()} />;
    case "map":
      return selectedTrip && selectedTrip.itinerary.length ? <MapScreen trip={selectedTrip} />
        : <NoTrip title={t("empty.map.title")} message={t("empty.map.message")}
            onStart={() => (selectedTrip ? setTab("chat") : startNewTrip())} />;
    case "profile":
      return <ProfileView />;
  }
}

function Gate() {
  const { status, user } = useAuth();
  if (status === "loading") return <Splash />;
  if (status !== "signedIn" || !user) return <SignInView />;
  return (
    <AppProvider key={user.uid} userId={user.uid}>
      <div className="relative mx-auto min-h-dvh max-w-[480px] bg-bg shadow-[0_0_60px_rgb(15_40_80/0.08)]">
        <main className="pb-[calc(76px+env(safe-area-inset-bottom))]">
          <Screen />
        </main>
        <TabBar />
      </div>
    </AppProvider>
  );
}

export default function Page() {
  return (
    <I18nProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </I18nProvider>
  );
}
