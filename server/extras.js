// The second set of board artifacts: data and pure helpers. The Table keeps the state (see game.js, "second set").
// Prices, listings, shifts, tickets and rooms are invented for the game, like every other price in Cabrillo;
// the board labels them as estimates or samples.
import { PICKUP, placeOf, placeField, estimate, rideOptions } from './places.js';
import { planWhen, clock } from './artifacts.js';

const money = (x) => Math.round(x * 100) / 100;

// ---------- live cost per person ----------
// Each scenario's prices from its own "For this game" notes. Returns the items that make up one person's cost.
const TRAVEL = (plan, place, n) => {
  const t = plan.travel || plan.transport;
  if (!t || !place) return [];
  const e = estimate(PICKUP, place);
  if (t === 'transit') return [{ label: 'Bus or trolley, there and back', amount: 5 }];
  if (t === 'carpool') return [{ label: 'Gas, split', amount: money(Math.max(4, (e.miles * 2 * 0.2) / Math.max(1, n))) }];
  if (t === 'rideshare') { const r = rideOptions(e, n).find((x) => x.id === 'standard'); return [{ label: 'Rideshare, there and back', amount: money(r.perPerson * 2) }]; }
  return [];
};
export const COSTS = {
  outing: (p, n, pl) => [...(p.where === 'oldtown' ? [{ label: 'Food in Old Town', amount: 15 }] : p.where === 'balboa' ? [{ label: 'A museum, if you go in', amount: 12, optional: true }] : p.where ? [{ label: `${p.where === 'cove' ? 'The cove' : 'The hike'} is free`, amount: 0 }] : []), ...TRAVEL(p, pl, n)],
  dinner: (p, n, pl) => [...(p.where ? [{ label: 'Dinner', amount: { pricecenter: 10, hillcrest: 14, littleitaly: 14, convoy: 30 }[p.where] || 20 }] : []), ...TRAVEL(p, pl, n)],
  trip: (p, n) => {
    const days = p.stay === 'daytrip' ? 1 : 2;
    return [
      ...(p.transport === 'amtrak' ? [{ label: 'Amtrak, round trip', amount: 40 }] : p.transport === 'rental' ? [{ label: `Rental car, ${days} day${days > 1 ? 's' : ''}, split`, amount: money((60 * days) / n) }] : p.transport === 'carpool' ? [{ label: 'Gas, split', amount: money(45 / n) }] : []),
      ...(p.stay === 'airbnb' ? [{ label: 'Airbnb, one night', amount: 50 }] : p.stay === 'camp' ? [{ label: 'Campsite, split', amount: money(35 / n) }] : []),
      ...(p.where ? [{ label: `Food, ${days} day${days > 1 ? 's' : ''}`, amount: 25 * days }] : [])
    ];
  },
  birthday: (p, n) => [
    ...(p.what ? [{ label: { dinner: 'Dinner out', party: 'Party snacks and drinks', karaoke: 'Karaoke room', escape: 'Escape room' }[p.what], amount: { dinner: 25, party: 10, karaoke: 15, escape: 35 }[p.what] }] : []),
    ...(p.gift === 'group' ? [{ label: 'Share of the group gift', amount: money(80 / n) }] : p.gift === 'each' ? [{ label: 'Your own gift', amount: 20 }] : [])
  ],
  concert: (p, n, pl) => [...(p.show ? [{ label: p.tickets === 'seats' ? 'Reserved seat' : 'Ticket', amount: ({ pop: 90, indie: 30, jazz: 35 }[p.show]) + (p.tickets === 'seats' ? 20 : 0) }] : []), ...TRAVEL(p, pl, n)],
  event: (p, n) => (p.budget ? [{ label: 'Share of the event budget', amount: money(({ free: 0, under50: 50, over50: 150 }[p.budget]) / Math.max(n, 1)) }] : []),
  potluck: (p, n) => [...(p.main ? [{ label: 'Share of the main dish', amount: money(({ turkey: 45, lasagna: 25, tacos: 35 }[p.main]) / n) }] : []), ...(p.drinks === 'front' ? [{ label: 'Share of the drinks', amount: money(30 / n) }] : p.drinks === 'bring' ? [{ label: 'Drinks you bring', amount: 8 }] : [])],
  volunteer: (p, n, pl) => [{ label: 'Volunteering is free', amount: 0 }, ...(p.after === 'lunch' ? [{ label: 'Lunch together', amount: 15 }] : p.after === 'coffee' ? [{ label: 'Coffee', amount: 6 }] : []), ...TRAVEL(p, pl, n)],
  cleanup: (p, n, pl) => [...(p.supplies === 'buy' ? [{ label: 'Gloves and bags, split', amount: money(40 / n) }] : []), ...TRAVEL(p, pl, n)],
  gaming: (p, n) => (p.snacks === 'split' ? [{ label: 'Food delivery, split', amount: money(45 / n) }] : p.snacks === 'bring' ? [{ label: 'Snacks you bring', amount: 8 }] : []),
  study: (p, n) => (p.food === 'pizza' ? [{ label: 'Pizza, split', amount: money(24 / n) }] : []),
  moving: (p, n) => [...(p.truck === 'uhaul' ? [{ label: 'U-Haul and miles, split', amount: money(62 / n) }] : p.truck === 'movers' ? [{ label: 'Movers, split', amount: money(400 / n) }] : p.truck === 'cars' ? [{ label: 'Gas, split', amount: money(15 / n) }] : [])],
  sports: (p) => (p.shirts === 'buy' ? [{ label: 'Matching shirt', amount: 20 }] : []),
  anniversary: (p, n) => [...(p.where ? [{ label: 'Your meal', amount: { italian: 26, dimsum: 20, mexican: 18 }[p.where] }] : []), ...(p.gift ? [{ label: 'Share of the gift', amount: money(({ album: 40, flowers: 50, trip: 300 }[p.gift]) / n) }] : []), ...(p.ride === 'rideshare' ? [{ label: 'Their rideshare, split', amount: money(36 / n) }] : [])],
  roommates: (p, n) => (p.clean === 'cleaner' ? [{ label: 'Cleaner, a month', amount: money(120 / n), monthly: true }] : []),
  housing: (p) => (p.area && p.rooms ? [{ label: `Rent, ${p.rooms === 'singles' ? 'a single' : 'a shared room'} in ${{ utc: 'UTC', pb: 'Pacific Beach', clairemont: 'Clairemont' }[p.area]}, a month`, amount: Math.round(({ utc: 1200, pb: 1400, clairemont: 850 }[p.area]) * (p.rooms === 'shared' ? 0.65 : 1)), monthly: true }] : [])
};
// The budget the group picked as a range in dollars per person, read from the option's name ("$15 to $30").
export function budgetRange(task, plan) {
  const f = task.fields.find((x) => /budget|rent/.test(x.id));
  const o = f && plan[f.id] ? f.options.find((x) => x.id === plan[f.id]) : null;
  if (!o) return null;
  const nums = (o.name.replace(/,/g, '').match(/\$?(\d+)/g) || []).map((x) => +x.replace('$', ''));
  const total = /total/i.test(o.name);
  if (/free/i.test(o.name)) return { lo: 0, hi: 0, name: o.name, total };
  if (/under/i.test(o.name)) return { lo: 0, hi: nums[0], name: o.name, total };
  if (/over/i.test(o.name)) return { lo: nums[0], hi: null, name: o.name, total };
  return nums.length >= 2 ? { lo: nums[0], hi: nums[1], name: o.name, total } : null;
}
export function costFor(task, plan, n) {
  const f = COSTS[task.id];
  if (!f) return null;
  const pf = placeField(task);
  const place = pf && plan[pf] ? placeOf(task, plan[pf]) : null;
  const items = f(plan, Math.max(1, n), place).filter(Boolean);
  if (!items.length) return null;
  const total = money(items.filter((x) => !x.optional).reduce((a, x) => a + x.amount, 0));
  return { items, total, monthly: items.some((x) => x.monthly), budget: budgetRange(task, plan) };
}

// ---------- carpool ----------
// Seats a person's car has for others, from their basic facts ("room for 4 people" means the driver and 3 more).
export function seatsFromFact(text) {
  const t = String(text || '');
  if (/do not have a car|no car|do not drive/i.test(t)) return 0;
  const more = t.match(/room for (\d+) more/i); if (more) return +more[1];
  const all = t.match(/room for (\d+) people/i); if (all) return Math.max(1, +all[1] - 1);
  return /have a car/i.test(t) ? 3 : 0;
}
export const carpoolPicked = (plan) => plan.travel === 'carpool' || plan.transport === 'carpool' || plan.truck === 'cars';

// ---------- chores ----------
export const CHORES = ['Kitchen and dishes', 'Bathroom', 'Trash and recycling', 'Floors and vacuum'];

// ---------- work split ----------
export function sectionsFor(taskId, plan) {
  if (taskId === 'project') {
    if (plan.split === 'role') return { key: 'role', cap: 1, items: ['Research', 'Writing', 'Editing', 'Slides'] };
    if (plan.split === 'all') return { key: 'all', cap: 9, items: ['Outline together', 'Draft together', 'Edit together', 'Slides together'] };
    return { key: 'section', cap: 1, items: ['Part 1: Introduction', 'Part 2: Background', 'Part 3: Method', 'Part 4: Results and discussion'] };
  }
  if (taskId === 'hackathon') {
    if (plan.roles === 'pair') return { key: 'pair', cap: 2, items: ['Pair A: build the core', 'Pair B: build the screens and the demo'] };
    if (plan.roles === 'free') return { key: 'free', cap: 9, items: ['Idea and plan', 'Build', 'Polish', 'Demo video and pitch'] };
    return { key: 'fixed', cap: 1, items: ['Frontend', 'Backend', 'Design', 'Pitch and demo'] };
  }
  return null;
}
// Dates for the timeline: the draft (the weekday the plan names) and the final (the next Friday after it).
export function projectDates(plan) {
  const draft = planWhen([{ tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday' }[plan.draft] || '']);
  let final = planWhen(['Friday']);
  if (final && draft && draft.daysAway >= final.daysAway) final = { ...final, daysAway: final.daysAway + 7, date: addDays(final.date, 7) };
  return { draft, final };
}
const addDays = (date, d) => { const x = new Date(`${date}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
export const HACK_MILESTONES = [[0, 'Kickoff'], [2, 'Idea locked'], [10, 'First demo'], [18, 'Feature freeze'], [22, 'Submit'], [24, 'Judging']];

// ---------- tickets and rooms (each person answers privately) ----------
export const TICKETS = {
  pop: [{ id: 'floor', name: 'Floor, standing', price: 90, ga: true }, { id: 'lower', name: 'Lower bowl seat', price: 120 }, { id: 'upper', name: 'Upper bowl seat', price: 65 }],
  indie: [{ id: 'ga', name: 'General admission', price: 30, ga: true }, { id: 'balcony', name: 'Balcony seat', price: 40 }],
  jazz: [{ id: 'lawn', name: 'Lawn', price: 35, ga: true }, { id: 'reserved', name: 'Reserved seat', price: 55 }, { id: 'box', name: 'Box seat', price: 85 }]
};
// Bookable rooms: which option of which part is a room, and its name.
export const ROOMS = {
  study: { field: 'where', option: 'geisel', name: 'Geisel Library group study room', length: 'length' },
  meeting: { field: 'format', option: 'person', name: 'Conference room at work' },
  event: { field: 'where', option: 'clubroom', name: 'Club room, Student Center' },
  gaming: { field: 'where', option: 'pc', name: 'Price Center game room' },
  potluck: { field: 'where', option: 'clubroom', name: 'Club room on campus' }
};
export function roomSlots(task, plan) {
  const names = task.fields.map((f) => f.options.find((o) => o.id === plan[f.id])?.name || '').filter(Boolean);
  const w = planWhen(names);
  const start = w?.minutes ?? 18 * 60;
  const hours = task.id === 'study' ? ({ h1: 1, h2: 2, h3: 3 }[plan.length] || 2) : task.id === 'meeting' ? 0.5 : 3;
  return [-60, 0, 60].map((d) => start + d).filter((m) => m >= 7 * 60 && m + hours * 60 <= 24 * 60)
    .map((m) => ({ id: `t${m}`, name: `${w ? `${w.dayName} ` : ''}${clock(m)} to ${clock(m + hours * 60)}`, price: 0 }));
}

// ---------- apartment listings (samples) ----------
export const LISTINGS = [
  { id: 'l1', area: 'utc', name: 'Regents Court', beds: 3, baths: 2, rent: 3900, bus: 'SuperLoop 201/202', min: 12, lat: 32.8705, lng: -117.2105, lease: ['june', 'sept'], perks: ['Pool', 'Gym'] },
  { id: 'l2', area: 'utc', name: 'La Jolla Crossroads', beds: 4, baths: 2, rent: 4700, bus: 'SuperLoop 201/202', min: 10, lat: 32.8735, lng: -117.2235, lease: ['sept'], perks: ['In-unit laundry'] },
  { id: 'l3', area: 'utc', name: 'Costa Verde Village', beds: 2, baths: 2, rent: 3300, bus: 'Route 30', min: 9, lat: 32.8640, lng: -117.2290, lease: ['june'], perks: ['Parking'] },
  { id: 'l4', area: 'pb', name: 'Garnet Ave flat', beds: 3, baths: 1, rent: 4200, bus: 'Route 30', min: 28, lat: 32.7985, lng: -117.2500, lease: ['june', 'sept'], perks: ['Two blocks to the beach'] },
  { id: 'l5', area: 'pb', name: 'Crown Point duplex', beds: 4, baths: 2, rent: 5600, bus: 'Route 8', min: 32, lat: 32.7880, lng: -117.2380, lease: ['sept'], perks: ['Patio', 'Parking'] },
  { id: 'l6', area: 'pb', name: 'Mission Blvd studio pair', beds: 2, baths: 1, rent: 3000, bus: 'Route 30', min: 30, lat: 32.7930, lng: -117.2545, lease: ['june'], perks: ['Ocean view'] },
  { id: 'l7', area: 'clairemont', name: 'Clairemont Mesa house', beds: 4, baths: 2, rent: 3600, bus: 'Route 41', min: 20, lat: 32.8290, lng: -117.2010, lease: ['june', 'sept'], perks: ['Yard', 'Garage'] },
  { id: 'l8', area: 'clairemont', name: 'Balboa Ave apartments', beds: 3, baths: 2, rent: 2700, bus: 'Route 27', min: 24, lat: 32.8195, lng: -117.1880, lease: ['sept'], perks: ['In-unit laundry'] },
  { id: 'l9', area: 'clairemont', name: 'Genesee townhome', beds: 2, baths: 1.5, rent: 2100, bus: 'Route 41', min: 18, lat: 32.8370, lng: -117.2050, lease: ['june'], perks: ['Parking'] }
];
export const perPerson = (l, rooms) => Math.round(l.rent / (rooms === 'shared' ? l.beds * 2 : l.beds));

// ---------- moving truck ----------
export const TRUCKS = [
  { id: 't10', name: '10 ft truck', fits: 'A dorm room or studio', base: 29.95, len: 10 },
  { id: 't15', name: '15 ft truck', fits: 'A one or two bedroom', base: 39.95, len: 15 },
  { id: 't20', name: '20 ft truck', fits: 'Two or three bedrooms', base: 49.95, len: 20 }
];
export const PER_MILE = 1.19;
export const truckQuote = (t, miles, n) => { const total = money(t.base + PER_MILE * miles + 15); return { total, each: money(total / Math.max(1, n)) }; };

// ---------- gift pool ----------
export const GIFTS = {
  birthday: [{ name: 'Wireless earbuds', price: 80 }, { name: 'Concert tickets for Sam', price: 120 }, { name: 'A custom cake', price: 45 }, { name: 'A photo book of the group', price: 40 }],
  anniversary: [{ name: 'A photo album', price: 40, option: 'album' }, { name: 'Flowers', price: 50, option: 'flowers' }, { name: 'A weekend trip voucher', price: 300, option: 'trip' }]
};

// ---------- team roster ----------
// Spots on a drawing of the court or field, in a 100 by 60 box.
export const ROSTER = {
  basketball: { surface: 'court', spots: [['pg', 'Point guard', 50, 46], ['sg', 'Shooting guard', 16, 34], ['sf', 'Small forward', 84, 34], ['pf', 'Power forward', 30, 12], ['c', 'Center', 70, 12]] },
  volleyball: { surface: 'net', spots: [['oh1', 'Outside hitter', 16, 14], ['mb', 'Middle blocker', 50, 14], ['opp', 'Opposite', 84, 14], ['oh2', 'Outside hitter', 16, 44], ['lib', 'Libero', 50, 44], ['s', 'Setter', 84, 44]] },
  soccer: { surface: 'pitch', spots: [['gk', 'Goalkeeper', 9, 30], ['d1', 'Defender', 26, 12], ['d2', 'Defender', 26, 48], ['m1', 'Midfielder', 52, 22], ['m2', 'Midfielder', 52, 40], ['f1', 'Forward', 80, 14], ['f2', 'Forward', 80, 46]] },
  ultimate: { surface: 'endzone', spots: [['c1', 'Cutter', 13, 13], ['c2', 'Cutter', 38, 13], ['c3', 'Cutter', 62, 13], ['c4', 'Cutter', 87, 13], ['h1', 'Handler', 25, 44], ['h2', 'Handler', 50, 44], ['h3', 'Handler', 75, 44]] }
};
export const OPPONENTS = ['Triton Tidal', 'Muir Moose', 'Revelle Rays', 'Sixth Sense'];
export const SIZES = ['XS', 'S', 'M', 'L', 'XL'];

// ---------- meeting agenda ----------
export const AGENDA = [['Wins from last week', 5], ['Schedules and shifts', 10], ['Problems to fix', 10], ['Next steps and owners', 5]];

// ---------- study plan ----------
export const STUDY_TOPICS = ['Lecture slides, weeks 1 to 3', 'Lecture slides, weeks 4 to 6', 'Practice midterm, part A', 'Practice midterm, part B', 'One-page formula sheet'];

// ---------- volunteer shifts ----------
export const SHIFTS = {
  foodbank: { jobs: [['Sorting donations', 0, 2], ['Packing boxes', 1, 2], ['Distribution line', 0, 3]], check: ['Closed-toe shoes', 'Sign the online waiver', 'A hair tie or a cap'] },
  shelter: { jobs: [['Dog walking', 0, 2], ['Cleaning kennels', 1, 2], ['Cat socializing', 0, 3]], check: ['Clothes that can get dirty', 'Sign the online waiver', 'No food in your pockets'] },
  tutoring: { jobs: [['Reading with kids', 0, 2], ['Homework help', 1, 2], ['Setup and cleanup', 0, 3]], check: ['Background check form', 'Sign the online waiver', 'A favorite kids book'] }
};
export const SHIFT_START = { sat: 9 * 60, sun: 13 * 60, wed: 14 * 60 };

// ---------- invites ----------
export const INVITE_TASKS = new Set(['event', 'birthday', 'potluck']);
export function inviteText(task, names) {
  const what = names.what || names.main || task.short;
  const parts = [names.when, names.where].filter(Boolean).join(', ');
  if (task.id === 'birthday') return `Sam turns 21! Join us for a surprise ${String(names.what || 'party').toLowerCase()}${parts ? `, ${parts}` : ''}. Please keep it secret from Sam.`;
  if (task.id === 'potluck') return `You are invited to Friendsgiving${parts ? `, ${parts}` : ''}. ${names.main ? `${names.main} is on us; ` : ''}bring a dish to share if you can.`;
  return `You are invited: ${what}${parts ? `, ${parts}` : ''}. New members are very welcome.`;
}
