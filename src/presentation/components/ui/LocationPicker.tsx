"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const DEFAULT_CENTER: [number, number] = [28.4913, 34.5131]; // Dahab
const DEFAULT_ZOOM = 15;

export function LocationPicker({
  lat,
  lng,
  onLocationChange,
}: {
  lat: number | null;
  lng: number | null;
  onLocationChange: (lat: number, lng: number) => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [detecting, setDetecting] = useState(false);

  const center: [number, number] = lat && lng ? [lat, lng] : DEFAULT_CENTER;

  const initMap = useCallback(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current, {
      center,
      zoom: lat && lng ? 17 : DEFAULT_ZOOM,
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);

    // Inline SVG pin so every device renders the same pixels instead
    // of whatever emoji font the platform happens to ship.
    const pinIcon = L.divIcon({
      className: "",
      html: `<div style="transform:translate(-50%,-100%);filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3))">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="#e11d48" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 10c0 7-8 13-8 13s-8-6-8-13a8 8 0 1 1 16 0Z" />
          <circle cx="12" cy="10" r="3" fill="#ffffff" stroke="none" />
        </svg>
      </div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 32],
    });

    const marker = L.marker(center, { draggable: true, icon: pinIcon }).addTo(map);
    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      onLocationChange(pos.lat, pos.lng);
    });

    map.on("click", (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      onLocationChange(e.latlng.lat, e.latlng.lng);
    });

    mapInstance.current = map;
    markerRef.current = marker;
  }, [center, lat, lng, onLocationChange]);

  useEffect(() => {
    initMap();
    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
        markerRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mapInstance.current && markerRef.current && lat && lng) {
      markerRef.current.setLatLng([lat, lng]);
      mapInstance.current.setView([lat, lng], 17);
    }
  }, [lat, lng]);

  const handleDetect = () => {
    if (!navigator.geolocation) return;
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onLocationChange(pos.coords.latitude, pos.coords.longitude);
        setDetecting(false);
      },
      () => setDetecting(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div className="space-y-2">
      <div
        ref={mapRef}
        className="w-full h-[220px] rounded-xl border-2 border-sand-200 overflow-hidden z-0"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleDetect}
          disabled={detecting}
          className="flex-1 py-2 rounded-lg border border-sand-200 text-xs font-bold text-ocean-600 active:scale-95 transition disabled:opacity-50"
        >
          {detecting ? "Detecting..." : "Use My Location"}
        </button>
        {lat && lng && (
          <span className="text-[10px] text-status-good-600 font-bold">
            {lat.toFixed(4)}, {lng.toFixed(4)}
          </span>
        )}
      </div>
      <p className="text-[10px] text-text-muted text-center">Tap the map or drag the pin to set your location</p>
    </div>
  );
}
