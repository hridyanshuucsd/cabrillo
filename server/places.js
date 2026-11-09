// Real places for the map, ride and table cards. Coordinates are real; prices, drivers and restaurants are demo values.
// Nothing is booked or charged. Every card says so.

export const PICKUP = { name: 'UC San Diego, Price Center', lat: 32.8798, lng: -117.2359 };

const APT = [32.8700, -117.2230]; // a student apartment near UTC
const GEO = {
  outing: { cove: [32.8503, -117.2713], balboa: [32.7341, -117.1446], oldtown: [32.7549, -117.1970], torrey: [32.9203, -117.2536] },
  event: { clubroom: [32.8797, -117.2362], shores: [32.8574, -117.2567], apartment: APT },
  dinner: { convoy: [32.8243, -117.1551], littleitaly: [32.7240, -117.1688], hillcrest: [32.7484, -117.1617], pricecenter: [32.8798, -117.2359] },
  study: { geisel: [32.8812, -117.2375], pc: [32.8798, -117.2359], apt: APT },
  trip: { la: [34.0562, -118.2365], jtree: [34.1347, -116.3131], bigbear: [34.2439, -116.9114], temecula: [33.4936, -117.1484] },
  potluck: { apt: APT, park: [32.7341, -117.1446], clubroom: [32.8797, -117.2362] },
  gaming: { apt: APT, pc: [32.8798, -117.2359] },
  anniversary: { italian: [32.7240, -117.1688], dimsum: [32.8243, -117.1551], mexican: [32.7549, -117.1970] },
  cleanup: { pb: [32.7948, -117.2554], ob: [32.7499, -117.2510], shores: [32.8574, -117.2567] },
  concert: { pop: [32.7556, -117.2121], indie: [32.7475, -117.1293], jazz: [32.7065, -117.1623] },
  housing: { utc: [32.8700, -117.2110], pb: [32.7948, -117.2554], clairemont: [32.8326, -117.2004] },
  volunteer: { foodbank: [32.8829, -117.1564], shelter: [32.7746, -117.2001], tutoring: [32.8283, -117.2016] }
};
// The plan field that names a place, for each task.
const PLACE_FIELD = { concert: 'show', housing: 'area' };
const RESTAURANT = { cove: 'Cafe near La Jolla Cove', balboa: 'Cafe in Balboa Park', oldtown: 'Taco restaurant in Old Town', torrey: 'Cafe near Torrey Pines', shores: 'Grill near La Jolla Shores', clubroom: 'Pizza place near campus', apartment: 'Pizza place nearby' };

export function placeField(task) {
  const id = PLACE_FIELD[task.id] || 'where';
  return task.fields.find((f) => f.id === id) ? id : null;
}
export function placeOf(task, optionId) {
  const ll = GEO[task.id]?.[optionId];
  if (!ll) return null;
  const f = task.fields.find((x) => x.id === placeField(task));
  const o = f?.options.find((x) => x.id === optionId);
  return { id: optionId, name: o?.name || optionId, lat: ll[0], lng: ll[1], restaurant: cap(o?.place || RESTAURANT[optionId] || `Restaurant near ${o?.name || 'there'}`) };
}
export function placesOf(task) {
  const f = task.fields.find((x) => x.id === placeField(task));
  return f ? f.options.map((o) => placeOf(task, o.id)).filter(Boolean) : [];
}
const cap = (s) => s.replace(/^an? /i, '').replace(/^\w/, (c) => c.toUpperCase());

// Straight-line distance in miles.
export function miles(a, b) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// Rough road distance and drive time when no route service answers: roads are about 1.3 times longer than a straight line.
export function estimate(a, b) {
  const mi = miles(a, b) * 1.3;
  const mph = mi > 40 ? 55 : mi > 8 ? 32 : 22;
  return { miles: round1(mi), minutes: Math.max(3, Math.round((mi / mph) * 60 + 3)) };
}
const round1 = (x) => Math.round(x * 10) / 10;

// A gently curved line between two points, used to draw a route when the route service is unavailable.
function curve(a, b, n = 24) {
  const mx = (a.lat + b.lat) / 2, my = (a.lng + b.lng) / 2;
  const dx = b.lat - a.lat, dy = b.lng - a.lng;
  const cx = mx - dy * 0.12, cy = my + dx * 0.12;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return [round5((1 - t) ** 2 * a.lat + 2 * (1 - t) * t * cx + t * t * b.lat), round5((1 - t) ** 2 * a.lng + 2 * (1 - t) * t * cy + t * t * b.lng)];
  });
}
const round5 = (x) => Math.round(x * 1e5) / 1e5;
const thin = (pts) => { if (pts.length <= 160) return pts; const step = Math.ceil(pts.length / 160); return pts.filter((_, i) => i % step === 0 || i === pts.length - 1); };

// Road route from the public OSRM service (OpenStreetMap data). Cached; falls back to an estimate within 2.5 seconds.
const routeCache = new Map();
export async function route(a, b) {
  const key = `${a.lat},${a.lng};${b.lat},${b.lng}`;
  if (routeCache.has(key)) return routeCache.get(key);
  let out = null;
  // Mapbox Directions when a token is set (more reliable), else the public OSRM server.
  if (process.env.MAPBOX_TOKEN && process.env.ROUTING !== 'off') {
    try {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${a.lng},${a.lat};${b.lng},${b.lat}?geometries=geojson&overview=simplified&access_token=${process.env.MAPBOX_TOKEN}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
      const rt = r.ok ? (await r.json()).routes?.[0] : null;
      if (rt) out = { points: thin(rt.geometry.coordinates.map(([lng, lat]) => [round5(lat), round5(lng)])), miles: round1(rt.distance / 1609.34), minutes: Math.max(3, Math.round(rt.duration / 60)), source: 'mapbox' };
    } catch { /* fall back below */ }
  }
  if (!out && process.env.ROUTING !== 'off') {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=geojson`;
      const r = await fetch(url, { signal: AbortSignal.timeout(2500), headers: { 'User-Agent': 'Cabrillo class project (UC San Diego)' } });
      if (r.ok) {
        const j = await r.json();
        const rt = j.routes?.[0];
        if (rt) {
          const pts = thin(rt.geometry.coordinates.map(([lng, lat]) => [round5(lat), round5(lng)]));
          out = { points: pts, miles: round1(rt.distance / 1609.34), minutes: Math.max(3, Math.round(rt.duration / 60)), source: 'osrm' };
        }
      }
    } catch { /* fall back below */ }
  }
  if (!out) out = { points: curve(a, b), ...estimate(a, b), source: 'estimate' };
  routeCache.set(key, out);
  return out;
}

// Ride types, priced like a typical ride app in San Diego (demo prices).
export const RIDE_TYPES = [
  { id: 'standard', name: 'Standard', seats: 4, mult: 1, note: 'Everyday rides' },
  { id: 'xl', name: 'XL', seats: 6, mult: 1.55, note: 'Room for 6' },
  { id: 'green', name: 'Green', seats: 4, mult: 1.12, note: 'Electric car' }
];
export function rideOptions(r, n) {
  return RIDE_TYPES.map((t, i) => {
    const cars = Math.ceil(n / t.seats);
    const perCar = Math.max(9, 2.55 + 1.6 * r.miles + 0.32 * r.minutes) * t.mult;
    const total = Math.round(perCar * cars * 100) / 100;
    return { id: t.id, name: t.name, seats: t.seats, note: t.note, cars, total, perPerson: Math.round((total / n) * 100) / 100, pickupMin: 3 + i * 2 };
  });
}

// Three reservation times around the plan's time, if it names one.
export function slotsFor(whenName) {
  const w = String(whenName || '').toLowerCase();
  const day = (w.match(/monday|tuesday|wednesday|thursday|friday|saturday|sunday/) || [''])[0];
  const D = day ? day[0].toUpperCase() + day.slice(1) + ' ' : '';
  const m = w.match(/(\d{1,2})(?::(\d\d))?\s*(am|pm)/);
  let base;
  if (m) base = ((+m[1] % 12) + (m[3] === 'pm' ? 12 : 0)) * 60 + (+m[2] || 0);
  else if (/morning|breakfast/.test(w)) base = 10 * 60;
  else if (/lunch|afternoon|noon/.test(w)) base = 13 * 60;
  else base = 19 * 60;
  return [base - 30, base, base + 30].map((t) => `${D}${fmt(t)}`);
}
const fmt = (t) => { const h = Math.floor(t / 60), m = t % 60; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`; };

// A demo driver and car.
const DRIVERS = [['Maria', 'Toyota Prius', 'white'], ['Jamal', 'Honda Accord', 'gray'], ['Linh', 'Tesla Model 3', 'black'], ['Diego', 'Kia Niro', 'blue'], ['Sofia', 'Hyundai Ioniq', 'silver'], ['Omar', 'Toyota Camry', 'red']];
export function driver(typeId) {
  const [name, car, color] = DRIVERS[Math.floor(Math.random() * DRIVERS.length)];
  const plate = `${1 + Math.floor(Math.random() * 9)}${'ABCDEFGHJKLMNPRSTUVWXYZ'[Math.floor(Math.random() * 23)]}${'ABCDEFGHJKLMNPRSTUVWXYZ'[Math.floor(Math.random() * 23)]}${'ABCDEFGHJKLMNPRSTUVWXYZ'[Math.floor(Math.random() * 23)]}${100 + Math.floor(Math.random() * 900)}`;
  return { name, car: typeId === 'xl' ? 'Honda Odyssey' : typeId === 'green' ? 'Tesla Model 3' : car, color, plate, rating: (4.7 + Math.random() * 0.29).toFixed(2) };
}
// Where the driver starts: about a mile from the pickup.
export function driverStart(p) {
  const ang = Math.random() * Math.PI * 2;
  return { lat: round5(p.lat + Math.cos(ang) * 0.014), lng: round5(p.lng + Math.sin(ang) * 0.016) };
}
