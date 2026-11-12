// Board artifacts that need data about the real world or about the scenario: the planned date and time, opening
// hours, the weather, an itinerary, and what each group should bring. Pure helpers; the Table keeps the state.
import { estimate, PICKUP } from './places.js';

// ---------- when is the plan? ----------
// The next date for the weekday the plan names, and the hour it names ("Friday at 8 pm", "Sunday afternoon").
// Times are San Diego times. Returns null when the plan names no day.
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export function hourOf(text) {
  const s = String(text).toLowerCase();
  const m = s.match(/(\d{1,2})(?::(\d\d))?\s*(am|pm)/);
  if (m) return ((+m[1] % 12) + (m[3] === 'pm' ? 12 : 0)) * 60 + (+m[2] || 0);
  if (/\bnoon\b/.test(s)) return 12 * 60;
  if (/morning|breakfast|brunch/.test(s)) return 10 * 60;
  if (/lunch/.test(s)) return 12 * 60 + 30;
  if (/afternoon/.test(s)) return 14 * 60;
  if (/evening|night|dinner/.test(s)) return 19 * 60;
  return null;
}
function sdNow() { // the current date in San Diego, as y, m, d and weekday
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'long' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, wd: DAYS.indexOf(p.weekday.toLowerCase()) };
}
export function planWhen(names) {
  const text = names.join(' ').toLowerCase();
  const wd = DAYS.findIndex((d) => text.includes(d));
  if (wd < 0) return null;
  const now = sdNow();
  const add = ((wd - now.wd + 7) % 7) || 7;
  const dt = new Date(Date.UTC(now.y, now.m - 1, now.d + add));
  const date = dt.toISOString().slice(0, 10);
  return { date, weekday: wd, dayName: DAYS[wd][0].toUpperCase() + DAYS[wd].slice(1), minutes: hourOf(text), daysAway: add };
}
export const clock = (min) => { const h = Math.floor(min / 60) % 24, m = min % 60; return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h >= 12 ? 'pm' : 'am'}`; };

// ---------- opening hours ----------
// Typical hours by kind of place, used when web search is not available. Each day is [open, close] in minutes, or
// null for closed; "always" places (beaches, parks, trails) are open all day. Marked as typical in the app.
const H = (o, c) => [o * 60, c * 60];
const TYPICAL = [
  [/apartment|house\b|home\b|dorm/i, { always: true, kind: 'Home' }],
  [/beach|cove|shores|trail|hike|torrey|park(?!ing)|bay/i, { always: true, kind: 'Outdoor place' }],
  [/^old town$/i, { days: Array(7).fill(H(10, 21)), kind: 'Neighborhood' }],
  [/museum|balboa/i, { days: [H(10, 17), null, H(10, 17), H(10, 17), H(10, 17), H(10, 17), H(10, 17)], kind: 'Museums' }],
  [/price center|food court/i, { days: [H(10, 18), H(8, 21), H(8, 21), H(8, 21), H(8, 21), H(8, 20), H(10, 18)], kind: 'Campus food court' }],
  [/geisel|library/i, { days: [H(10, 24), H(7, 24), H(7, 24), H(7, 24), H(7, 24), H(7, 18), H(10, 18)], kind: 'Library' }],
  [/club room|campus|game room/i, { days: [H(12, 17), H(9, 22), H(9, 22), H(9, 22), H(9, 22), H(9, 22), H(12, 17)], kind: 'Campus room' }],
  [/cafe|coffee|brunch|bakery/i, { days: Array(7).fill(H(7, 17)), kind: 'Cafe' }],
  [/\bbar\b|karaoke|escape/i, { days: [H(12, 23), H(16, 23), H(16, 23), H(16, 23), H(16, 24), H(12, 25), H(12, 25)], kind: 'Entertainment' }],
  [/korean|bbq|barbecue|pizza|ramen|taco|mexican|italian|dim sum|restaurant|grill|old town|convoy|hillcrest|little italy|dinner/i, { days: [H(11, 21), H(11, 21), H(11, 21), H(11, 21), H(11, 22), H(11, 22.5), H(11, 22.5)], kind: 'Restaurant' }],
  [/arena|observatory|shell|concert|show/i, { days: Array(7).fill(H(17, 23.5)), kind: 'Venue' }],
  [/food bank|shelter|library|tutor/i, { days: [H(10, 16), H(9, 17), H(9, 17), H(9, 17), H(9, 17), H(9, 17), H(9, 15)], kind: 'Organization' }]
];
export function typicalHours(name) {
  const hit = TYPICAL.find(([re]) => re.test(String(name).trim()));
  return hit ? { ...hit[1], source: 'typical' } : null;
}
// Is a place open at a day and minute? { open: true | false | null, today: [open, close] | null, opensAt, closesAt }.
export function openAt(hours, weekday, minute) {
  if (!hours) return { open: null };
  if (hours.always) return { open: true, today: [0, 24 * 60], always: true };
  const today = hours.days?.[weekday] ?? null;
  if (minute === null || minute === undefined) return { open: today ? null : false, today };
  if (!today) return { open: false, today: null };
  return { open: minute >= today[0] && minute < today[1], today, opensAt: today[0], closesAt: today[1] };
}
// "11:00-21:30" or "closed" per weekday, from a model's JSON, into the same shape as typical hours.
export function parseHours(j) {
  if (!j || typeof j !== 'object') return null;
  if (j.always === true) return { always: true, kind: j.kind || 'Place', source: 'web' };
  const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const t = (s) => { const m = String(s).trim().match(/^(\d{1,2}):?(\d\d)?\s*(am|pm)?$/i); if (!m) return null; let h = +m[1] % 24; if (m[3]) h = (h % 12) + (/pm/i.test(m[3]) ? 12 : 0); return h * 60 + (+m[2] || 0); };
  const days = keys.map((k) => {
    const v = j.hours?.[k];
    if (!v || /closed/i.test(v)) return null;
    const [a, b] = String(v).split(/\s*[-–to]+\s*/);
    const o = t(a), c = t(b);
    return o === null || c === null ? null : [o, c <= o ? c + 24 * 60 : c];
  });
  return days.some(Boolean) ? { days, kind: j.kind || 'Place', source: 'web' } : null;
}

// ---------- weather ----------
// Open-Meteo: free, no key. Hourly temperature, rain chance and conditions for one day at one place.
// WEATHER_FAKE=1 answers locally for tests.
const weatherCache = new Map();
export async function forecast(lat, lng, date) {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)},${date}`;
  if (weatherCache.has(key) && Date.now() - weatherCache.get(key).at < 30 * 60 * 1000) return weatherCache.get(key).v;
  let v = null;
  if (process.env.WEATHER_FAKE) {
    v = { date, hours: Array.from({ length: 24 }, (_, h) => ({ h, temp: Math.round(60 + 10 * Math.sin((h - 9) / 24 * Math.PI * 2)), rain: h > 15 ? 40 : 10, code: h > 15 ? 61 : 2 })), source: 'test' };
  } else {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,precipitation_probability,weather_code&temperature_unit=fahrenheit&timezone=America%2FLos_Angeles&start_date=${date}&end_date=${date}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const j = await r.json();
        const hr = j.hourly || {};
        v = { date, hours: (hr.time || []).map((t, i) => ({ h: +t.slice(11, 13), temp: Math.round(hr.temperature_2m[i]), rain: hr.precipitation_probability?.[i] ?? 0, code: hr.weather_code?.[i] ?? 0 })), source: 'open-meteo' };
        if (!v.hours.length) v = null;
      }
    } catch { v = null; }
  }
  if (v) weatherCache.set(key, { at: Date.now(), v });
  return v;
}
// WMO weather codes into a few kinds the card can draw.
export function sky(code) {
  if (code >= 95) return 'storm';
  if (code >= 51) return 'rain';
  if (code >= 45) return 'fog';
  if (code >= 3) return 'cloud';
  if (code >= 1) return 'partly';
  return 'clear';
}

// ---------- itinerary ----------
// Built from the plan: meet on campus, travel there, the main thing, and the way back. Each stop has a length in
// minutes; times follow from the start, so moving the start moves the whole day.
// When the plan names no time: the usual start for that kind of plan.
const DEFAULT_START = { concert: 19 * 60 + 30, dinner: 19 * 60, gaming: 19 * 60, study: 18 * 60, event: 19 * 60, potluck: 17 * 60, birthday: 19 * 60, anniversary: 18 * 60, volunteer: 10 * 60, cleanup: 9 * 60 };
// Plans whose "place" is an area to live in, not somewhere the group goes together: no day, hours or weather.
export const NO_TRIP = new Set(['housing']);
const MAIN = { dinner: 90, anniversary: 120, outing: 150, trip: 360, cleanup: 120, concert: 180, volunteer: 180, birthday: 150, potluck: 180, gaming: 180, event: 150, study: 120, moving: 240, hackathon: 24 * 60, sports: 60, meeting: 45, project: 90, housing: 60, roommates: 60, beachhouse: 120 };
// legMinutes: the travel time from the route card when there is one, so the chat and the board say the same number.
export function buildItinerary(task, plan, place, travelName, when, legMinutes) {
  const travel = String(travelName || '').toLowerCase();
  const e = place ? estimate(PICKUP, place) : { minutes: 15, miles: 5 };
  const near = place && e.miles <= 1.5; // on or next to campus: everyone walks
  const leg = e.minutes;
  const mins = near ? Math.max(5, Math.round(e.miles * 20)) : legMinutes || (/bus|trolley|transit|train|amtrak/.test(travel) ? Math.round(leg * 2.2 + 8) : leg);
  const how = near ? 'walk' : /bus|trolley|transit/.test(travel) ? 'transit' : /train|amtrak/.test(travel) ? 'train' : /walk/.test(travel) ? 'walk' : 'car';
  const main = (task.id === 'study' && { h1: 60, h2: 120, h3: 180 }[plan.length]) || MAIN[task.id] || 120;
  const startMain = when?.minutes ?? DEFAULT_START[task.id] ?? 14 * 60;
  const where = place?.name || 'the place';
  const stops = [
    // the meeting time is a round number (on the 5 minutes); the extra minutes are spent waiting at Price Center
    { kind: 'meet', title: 'Meet at Price Center', mins: 10 + ((startMain - mins - 10) % 5 + 5) % 5 },
    { kind: 'leg', title: `${how === 'transit' ? 'Bus or trolley' : how === 'train' ? 'Train' : how === 'walk' ? 'Walk' : 'Drive'} to ${where}`, mins, how },
    { kind: 'main', title: task.short === 'Group dinner' ? `Dinner at ${where}` : `${task.short} at ${where}`, mins: main },
    { kind: 'leg', title: 'Head back to campus', mins, how },
    { kind: 'end', title: 'Back on campus', mins: 0 }
  ];
  return { start: Math.max(0, startMain - mins - stops[0].mins), stops: stops.map((s, i) => ({ id: `s${i + 1}`, ...s })) };
}

// ---------- who brings what ----------
// A starting list for each scenario. People claim items, add their own, or remove ones they do not need.
const B = (cat, ...items) => items.map((name) => ({ cat, name }));
export const BRING = {
  potluck: [...B('Food', 'Main dish', 'A side', 'Another side', 'Dessert'), ...B('Drinks', 'Drinks', 'Ice'), ...B('Table', 'Plates, cups and forks', 'Napkins')],
  beachhouse: [...B('Groceries', 'Breakfast things', 'Snacks', 'Drinks'), ...B('Gear', 'Speaker', 'Beach towels', 'Sunscreen')],
  cleanup: [...B('Supplies', 'Trash bags', 'Gloves', 'Buckets'), ...B('Comfort', 'Water', 'Sunscreen', 'First aid kit')],
  outing: [...B('Essentials', 'Water', 'Snacks', 'Sunscreen'), ...B('Fun', 'Speaker', 'Frisbee')],
  trip: [...B('Road', 'Snacks for the ride', 'Phone chargers', 'Playlist'), ...B('Stay', 'Toiletries', 'Blankets')],
  gaming: [...B('Food', 'Chips', 'Drinks'), ...B('Games', 'Extra controllers', 'Board games')],
  event: [...B('Food', 'Snacks', 'Drinks'), ...B('Setup', 'Plates and cups', 'Speaker', 'Name tags')],
  birthday: [...B('Celebrate', 'Cake', 'Candles', 'Card for everyone to sign'), ...B('Setup', 'Decorations')],
  study: [...B('Study', 'Practice exam', 'Whiteboard markers'), ...B('Fuel', 'Snacks', 'Coffee')],
  moving: [...B('Packing', 'Boxes', 'Packing tape', 'Markers'), ...B('Moving', 'Dolly', 'Work gloves'), ...B('Fuel', 'Water and snacks')],
  volunteer: [...B('Bring', 'Water bottles', 'Sunscreen', 'Sign-up confirmation')],
  anniversary: [...B('For them', 'Card', 'Flowers', 'Photos for the album')],
  hackathon: [...B('Gear', 'Extension cord', 'Chargers', 'Monitor'), ...B('Fuel', 'Snacks', 'Energy drinks')],
  sports: [...B('Gear', 'Ball', 'Cones', 'Pump'), ...B('Comfort', 'Water', 'First aid kit')],
  concert: [...B('Bring', 'Tickets on your phone', 'Earplugs', 'Light jacket', 'Snacks for before')],
  roommates: [...B('Shared basics', 'Toilet paper', 'Dish soap', 'Paper towels', 'Cleaning spray', 'Trash bags')],
  dinner: [...B('After', 'Dessert spot ideas')],
  meeting: [...B('Meeting', 'Agenda', 'Notes doc', 'Video link')],
  project: [...B('Setup', 'Shared doc', 'Slide template', 'Sources list')],
  housing: [...B('Search', 'Listings to compare', 'Budget sheet', 'Questions for landlords')]
};
// Outdoor scenarios show the weather once a day is picked.
export const OUTDOOR = new Set(['outing', 'cleanup', 'beachhouse', 'trip', 'volunteer', 'potluck', 'concert', 'sports']);
