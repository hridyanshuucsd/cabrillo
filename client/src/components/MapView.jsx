import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Esri's light gray map with a separate layer of street and place names: clean, like a ride app, and no key needed.
// (CARTO tiles now need a key, and OpenStreetMap's own servers do not allow app traffic.)
const BASE = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
const LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}';
const ATTRIB = 'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors';

// With a Mapbox token (set MAPBOX_TOKEN on the server), maps use Mapbox's street style instead.
let mapboxToken = null;
const config = fetch('/api/config').then((r) => r.json()).then((c) => { mapboxToken = c.mapboxToken; }).catch(() => {});
function addTiles(m) {
  if (mapboxToken) {
    L.tileLayer(`https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/512/{z}/{x}/{y}@2x?access_token=${mapboxToken}`, {
      tileSize: 512, zoomOffset: -1, maxZoom: 19,
      attribution: '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(m);
  } else {
    L.tileLayer(BASE, { attribution: ATTRIB, maxNativeZoom: 16, maxZoom: 19 }).addTo(m);
    L.tileLayer(LABELS, { maxNativeZoom: 16, maxZoom: 19, pane: 'overlayPane' }).addTo(m);
  }
}

const CAR_SVG = '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="6" y="2.5" width="12" height="19" rx="4" fill="#10202b"/><rect x="8" y="6" width="8" height="4" rx="1.2" fill="#9fd3c9"/><rect x="8" y="15" width="8" height="3" rx="1" fill="#9fd3c9"/></svg>';

function icon(p) {
  const cls = p.kind || 'place';
  const html = cls === 'car' ? `<div class="mk-car" style="transform:rotate(${p.bearing || 0}deg)">${CAR_SVG}</div>`
    : `<div class="mk ${cls} ${p.active ? 'active' : ''}">${p.label ?? ''}</div>`;
  const size = cls === 'car' ? [26, 26] : cls === 'pickup' || cls === 'dropoff' ? [18, 18] : [26, 26];
  return L.divIcon({ className: 'mk-wrap', html, iconSize: size, iconAnchor: [size[0] / 2, size[1] / 2] });
}

// points: [{ lat, lng, kind: 'pickup'|'dropoff'|'place', label, active }]; route: [[lat, lng], ...]; car: { lat, lng, bearing }.
// A small map in the chat does not take touch input, so it never traps scrolling; the full-screen map does.
export default function MapView({ points = [], route, car, height = 160, interactive = false, className = '' }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const carMarker = useRef(null);
  const fit = useRef(null);

  useEffect(() => {
    const m = L.map(el.current, {
      zoomControl: interactive, dragging: interactive, touchZoom: interactive, doubleClickZoom: interactive,
      scrollWheelZoom: interactive, boxZoom: false, keyboard: interactive, tap: false, attributionControl: true, zoomSnap: 0.25
    });
    m.attributionControl.setPrefix(false);
    config.then(() => { if (map.current === m) addTiles(m); });
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    // The map is often created before its card has its final size; fit the pins and route again once it does.
    const ro = new ResizeObserver(() => { m.invalidateSize(); if (fit.current) fit.current(); });
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, [interactive]);

  // pins and route
  const key = JSON.stringify([points, route?.length]);
  useEffect(() => {
    const m = map.current; if (!m) return;
    layer.current.clearLayers();
    const all = [];
    if (route?.length) {
      L.polyline(route, { color: '#ffffff', weight: 7, opacity: 0.9 }).addTo(layer.current);
      L.polyline(route, { color: '#10202b', weight: 4 }).addTo(layer.current);
      all.push(...route);
    }
    for (const p of points) { L.marker([p.lat, p.lng], { icon: icon(p), keyboard: false, interactive: false }).addTo(layer.current); all.push([p.lat, p.lng]); }
    fit.current = () => {
      if (!el.current?.clientWidth) return;
      if (all.length === 1) m.setView(all[0], 14);
      else if (all.length) m.fitBounds(L.latLngBounds(all), { padding: [24, 24], maxZoom: 15 });
    };
    fit.current();
  }, [key]);

  // the moving car
  useEffect(() => {
    const m = map.current; if (!m) return;
    if (!car) { carMarker.current?.remove(); carMarker.current = null; return; }
    if (!carMarker.current) carMarker.current = L.marker([car.lat, car.lng], { icon: icon({ kind: 'car', bearing: car.bearing }), interactive: false, zIndexOffset: 1000 }).addTo(m);
    else { carMarker.current.setLatLng([car.lat, car.lng]); const d = carMarker.current.getElement()?.querySelector('.mk-car'); if (d) d.style.transform = `rotate(${car.bearing || 0}deg)`; }
  }, [car?.lat, car?.lng, car?.bearing]);

  return <div ref={el} className={`mapview ${className}`} style={{ height }} />;
}

// Google Maps links: no key needed. These open the real Google Maps app or site.
export const gmapsDirections = (from, to) => `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=driving`;
export const gmapsPlace = (p, q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q ? `${q} near ${p.lat},${p.lng}` : `${p.lat},${p.lng}`)}`;

// Position along a route, from 0 (start) to 1 (end), with the heading in degrees.
export function along(route, t) {
  if (!route?.length) return null;
  if (route.length === 1) return { lat: route[0][0], lng: route[0][1], bearing: 0 };
  const seg = []; let total = 0;
  for (let i = 1; i < route.length; i++) { const d = Math.hypot(route[i][0] - route[i - 1][0], (route[i][1] - route[i - 1][1]) * 0.84); seg.push(d); total += d; }
  let target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (target <= seg[i] || i === seg.length - 1) {
      const f = seg[i] ? Math.min(1, target / seg[i]) : 0;
      const a = route[i], b = route[i + 1];
      const bearing = (Math.atan2((b[1] - a[1]) * 0.84, b[0] - a[0]) * 180) / Math.PI;
      return { lat: a[0] + (b[0] - a[0]) * f, lng: a[1] + (b[1] - a[1]) * f, bearing };
    }
    target -= seg[i];
  }
  return null;
}
