"use client";

import { AppProvider, useApp } from "@/lib/app-state";
import { TabBar } from "@/components/TabBar";
import { HomeView } from "@/components/HomeView";
import { ChatView } from "@/components/ChatView";
import { ItineraryView } from "@/components/ItineraryView";
import { MapScreen } from "@/components/MapScreen";
import { ProfileView } from "@/components/ProfileView";
import { NoTrip } from "@/components/ui";

function Screen() {
  const { ready, tab, selectedTrip, startNewTrip, setTab } = useApp();
  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <img src="/mascot.webp" alt="" className="h-28 w-28 animate-pulse" />
      </div>
    );
  }
  switch (tab) {
    case "home":
      return <HomeView />;
    case "chat":
      return selectedTrip ? <ChatView key={selectedTrip.id} tripId={selectedTrip.id} />
        : <NoTrip title="No trip yet" message="Start a trip and I'll plan it with you, one question at a time." onStart={() => startNewTrip()} />;
    case "itinerary":
      return selectedTrip ? <ItineraryView trip={selectedTrip} />
        : <NoTrip title="No itinerary yet" message="Chat with Travel AI and your day-by-day plan will appear here." onStart={() => startNewTrip()} />;
    case "map":
      return selectedTrip && selectedTrip.itinerary.length ? <MapScreen trip={selectedTrip} />
        : <NoTrip title="Nothing to map yet" message="Once your itinerary has stops, I'll pin them here with the route between them."
            onStart={() => (selectedTrip ? setTab("chat") : startNewTrip())} />;
    case "profile":
      return <ProfileView />;
  }
}

export default function Page() {
  return (
    <AppProvider>
      <div className="relative mx-auto min-h-dvh max-w-[480px] bg-bg shadow-[0_0_60px_rgb(15_40_80/0.08)]">
        <main className="pb-[calc(76px+env(safe-area-inset-bottom))]">
          <Screen />
        </main>
        <TabBar />
      </div>
    </AppProvider>
  );
}
