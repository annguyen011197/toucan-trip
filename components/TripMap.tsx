"use client";

import { useEffect, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { Trip } from "@/lib/types";
import { hasLocation } from "@/lib/itinerary-engine";

const PRIMARY = "#1a7fe8";

function stopIcon(n: number, focused: boolean) {
  const size = focused ? 38 : 32;
  return L.divIcon({
    className: "stop-pin",
    iconSize: [size, size + 6],
    iconAnchor: [size / 2, size + 6],
    html: `<div style="display:flex;flex-direction:column;align-items:center">
      <div style="width:${size}px;height:${size}px;border-radius:50%;background:${PRIMARY};color:#fff;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.25)">${n}</div>
      <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid ${PRIMARY}"></div></div>`,
  });
}

const hotelIcon = L.divIcon({
  className: "stop-pin",
  iconSize: [36, 42],
  iconAnchor: [18, 42],
  html: `<div style="display:flex;flex-direction:column;align-items:center">
    <div style="width:36px;height:36px;border-radius:10px;background:#ce6000;color:#fff;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.25)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>
    </div>
    <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid #ce6000"></div></div>`,
});

function FitBounds({ points, focus }: { points: [number, number][]; focus?: [number, number] }) {
  const map = useMap();
  const key = JSON.stringify(points);
  useEffect(() => {
    if (focus) { map.flyTo(focus, 15, { duration: 0.6 }); return; }
    if (points.length === 1) map.setView(points[0], 14);
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, focus?.[0], focus?.[1], map]);
  return null;
}

export default function TripMap({ trip, day, interactive = true, focusedId, onSelect }: {
  trip: Trip; day: number; interactive?: boolean; focusedId?: string; onSelect?: (id: string) => void;
}) {
  const items = useMemo(() => (trip.itinerary.find((d) => d.day === day)?.items ?? []).filter(hasLocation), [trip, day]);
  const points = items.map((i) => [i.lat, i.lng] as [number, number]);
  const hotel = trip.hotel && hasLocation(trip.hotel) ? trip.hotel : undefined;
  const focused = items.find((i) => i.id === focusedId);
  const center: [number, number] = points[0] ?? (hotel ? [hotel.lat, hotel.lng] : [20, 0]);

  return (
    <MapContainer center={center} zoom={13} className="h-full w-full" zoomControl={false} dragging={interactive}
      scrollWheelZoom={interactive} doubleClickZoom={interactive} touchZoom={interactive} keyboard={interactive} attributionControl={interactive}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
      />
      <FitBounds points={points} focus={focused ? [focused.lat, focused.lng] : undefined} />
      {points.length > 1 && (
        <>
          <Polyline positions={points} pathOptions={{ color: "#ffffff", weight: 8, opacity: 0.9 }} />
          <Polyline positions={points} pathOptions={{ color: PRIMARY, weight: 4, dashArray: "8 8", lineCap: "round" }} />
        </>
      )}
      {items.map((it, idx) => (
        <Marker key={it.id} position={[it.lat, it.lng]} icon={stopIcon(idx + 1, it.id === focusedId)}
          eventHandlers={{ click: () => onSelect?.(it.id) }}>
          {interactive && <Tooltip direction="top" offset={[0, -40]}>{it.title}</Tooltip>}
        </Marker>
      ))}
      {hotel && (
        <Marker position={[hotel.lat, hotel.lng]} icon={hotelIcon}>
          {interactive && <Tooltip direction="top" offset={[0, -44]}>{hotel.name} (your stay)</Tooltip>}
        </Marker>
      )}
    </MapContainer>
  );
}
