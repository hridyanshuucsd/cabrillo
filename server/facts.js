// Basic facts about each seat: everyday details a person would know about themselves in the scenario ("you are
// staying both nights", "you have a car"). They give everyone, people and AI players alike, something concrete to say.
// Unlike the private limit, these are fine to share. A fact that follows from a limit (a one-night limit means you
// stay one night) is set by that limit, so facts never contradict limits; such a fact is marked private, because
// saying it gives the limit away.
// Each value is a sentence in the second person, or { text, ...numbers the bill uses }. Values are dealt like
// limits: shuffled per table, so people at one table differ.

const CAR = { id: 'car', label: 'Car', kw: ['car', 'drive', 'driving', 'pick up', 'pick you', 'a ride'], values: ['You have a car with room for 4 people.', 'You do not have a car.', 'You do not have a car.'] };
const noCar = (...ids) => Object.fromEntries(ids.map((id) => [id, 'You do not have a car.']));

export const FACTS = {
  outing: [
    { ...CAR, byLimit: noCar('no_car') },
    { id: 'home', label: 'Where you live', kw: ['live', 'coming from', 'far from', 'where are you'], values: ['You live on campus, a 5 minute walk from the trolley.', 'You live in University City, near a bus stop.', 'You live in Pacific Beach, 25 minutes from campus.'] }
  ],
  project: [
    { id: 'strength', label: 'What you are good at', kw: ['good at', 'strength', 'skill', 'role', 'best at'], values: ['You are good at research and finding sources.', 'You like writing and editing.', 'You are good at organizing and keeping deadlines.'], byLimit: { slides_person: 'You are the fastest at slides.' } },
    { id: 'free', label: 'When you are free', kw: ['free', 'schedule', 'available', 'when can you'], values: ['You are free most evenings.', 'You are free Monday and Thursday evenings.'], byLimit: { lab_wed: 'You are free Monday and Thursday evenings.', away_thu: 'You are free Monday and Wednesday evenings.' } }
  ],
  event: [
    { id: 'role', label: 'Your role in the club', kw: ['role', 'position', 'what do you do'], values: ['You run the club Instagram.', 'You are the club vice president.', 'You joined the club last quarter.', 'You are on the events committee.'], byLimit: { club_40: 'You are the club treasurer.' } },
    { id: 'bring', label: 'What you can bring', kw: ['bring', 'own', 'projector', 'games', 'cook'], values: ['You own a big board game collection.', 'You can borrow a projector.', 'You love cooking for groups.'] }
  ],
  dinner: [
    { id: 'diet', label: 'What you eat', kw: ['eat', 'diet', 'vegetarian', 'allerg', 'food'], values: ['You eat everything.', 'You love spicy food.', 'You do not eat pork.'], byLimit: { veg: 'You are vegetarian.' } },
    { ...CAR, byLimit: noCar('no_car') }
  ],
  study: [
    { id: 'home', label: 'Where you live', kw: ['live', 'commute', 'far', 'coming from'], values: ['You live on campus.', 'You live in University City, a short bus ride away.'], byLimit: { commute: 'You live 45 minutes away by bus.' } },
    { id: 'prep', label: 'How prepared you are', kw: ['material', 'lecture', 'understand', 'flashcards', 'behind', 'prepared', 'ready'], values: ['You understand the first half of the material well.', 'You are behind on the last two lectures.', 'You made a big set of flashcards.'] }
  ],
  trip: [
    { ...CAR, values: ['You have a car with room for 5 people.', 'You do not have a car.', 'You do not have a car.'], byLimit: noCar('carsick') },
    { id: 'been', label: 'Places you have been', kw: ['been', 'visited', 'ever gone', 'been to'], values: ['You have been to Los Angeles many times.', 'You have never been to Joshua Tree.', 'You went to Big Bear last winter.'] }
  ],
  roommates: [
    { id: 'schedule', label: 'Your schedule', kw: ['schedule', 'sleep', 'wake', 'bed', 'night owl', 'morning'], values: ['You are a night owl and study late.', 'You work weekend mornings.', 'You have a 9 am class most days.'], byLimit: { early_lab: 'You have a 7 am lab every weekday.', travel: 'You travel for work every other week.' } },
    { id: 'cook', label: 'Cooking', kw: ['cook', 'groceries', 'meal'], values: ['You cook most nights.', 'You mostly eat on campus.', 'You meal prep on Sundays.'], byLimit: { diet: 'You cook vegetarian meals most nights.' } }
  ],
  birthday: [
    { id: 'sam', label: 'You and Sam', kw: ['know sam', 'sam', 'friends'], values: ['You have known Sam since first year.', 'You are Sam\'s lab partner.', 'You live next door to Sam.'] },
    { id: 'likes', label: 'What Sam likes', kw: ['like', 'likes', 'into', 'enjoy', 'favorite'], values: ['Sam loves trying new restaurants.', 'Sam is really into puzzles.', 'Sam is a big foodie.'] }
  ],
  potluck: [
    { id: 'cook', label: 'What you can make', kw: ['cook', 'make', 'bring', 'dish'], values: ['You make a great mac and cheese.', 'You do not cook much, but you can buy drinks.', 'You can make guacamole and salsa.'] },
    { id: 'home', label: 'Where you live', kw: ['live', 'apartment', 'place', 'oven', 'kitchen'], values: ['You live in a shared apartment near campus.', 'You live in the dorms.'] }
  ],
  meeting: [
    { id: 'time', label: 'On the team', kw: ['team', 'how long', 'joined'], values: ['You have been on the team for a year.', 'You joined the team last month.', 'You write the weekly report.'] },
    { id: 'where', label: 'Where you work', kw: ['office', 'remote', 'work from', 'where do you work'], values: ['You work from the office near campus.', 'You split your time between home and the office.'], byLimit: { remote: 'You work fully remote from Los Angeles.' } }
  ],
  sports: [
    { id: 'played', label: 'Sports you have played', kw: ['played', 'play', 'experience', 'sport'], values: ['You played basketball in high school.', 'You played club volleyball.', 'You have played ultimate frisbee a few times.'] },
    { id: 'free', label: 'When you are free', kw: ['free', 'schedule', 'available'], values: ['You are free most evenings.', 'You are free Tuesday and Thursday evenings.'], byLimit: { work_tue: 'You are free Thursday evenings and weekends.' } }
  ],
  gaming: [
    { id: 'has', label: 'What you own', kw: ['own', 'switch', 'console', 'pc', 'games', 'controllers'], values: ['You own a Nintendo Switch with four controllers.', 'You have a gaming PC.', 'You own Catan and a few card games.'], byLimit: { weak_laptop: 'You own Catan and a few card games; your laptop is old.' } },
    { id: 'home', label: 'Where you live', kw: ['live', 'apartment', 'place', 'come over'], values: ['You live in an apartment near UTC.', 'You live in the dorms.'] }
  ],
  beachhouse: [
    { id: 'nights', label: 'Nights you are staying', kw: ['night', 'nights', 'stay', 'staying', 'how long'], values: [{ text: 'You are staying both nights, Friday and Saturday.', n: 2 }], byLimit: { one_night: { text: 'You can only stay Saturday night.', n: 1 } } },
    { id: 'room', label: 'Your room', kw: ['room', 'bedroom', 'sleep', 'couch', 'bed'], values: [{ text: 'You took the big room with its own bathroom.', w: 1.5 }, { text: 'You have a regular bedroom.', w: 1 }, { text: 'You have a regular bedroom.', w: 1 }, { text: 'You are sleeping on the pull-out couch.', w: 0.6 }] },
    { id: 'apps', label: 'How you pay people', kw: ['venmo', 'zelle', 'cash', 'pay', 'app'], values: ['You use Venmo and Zelle.', 'You use Venmo and Zelle.', 'You mostly use Venmo.'], byLimit: { no_venmo: 'You use Zelle; you do not have Venmo.', cash_risk: 'You use Venmo and Zelle, and you never carry cash.' } }
  ],
  anniversary: [
    { id: 'role', label: 'In the family', kw: ['cousin', 'oldest', 'closest', 'family'], values: ['You are the oldest cousin.', 'You live closest to your grandparents.', 'You run the family group chat.'] },
    { ...CAR, values: ['You have a car with room for 4 people.', 'You do not have a car.'] }
  ],
  cleanup: [
    { id: 'role', label: 'Your role in the club', kw: ['role', 'position', 'club'], values: ['You are the club secretary.', 'You joined the club this quarter.', 'You organized last year\'s cleanup.'], byLimit: { club_funds: 'You are the club treasurer.' } },
    { ...CAR, values: ['You have a car with room for 4 people.', 'You do not have a car.'], byLimit: noCar('no_car') }
  ],
  moving: [
    { id: 'help', label: 'How you can help', kw: ['lift', 'pack', 'help', 'good at'], values: ['You can lift heavy furniture.', 'You are good at packing boxes neatly.', 'You know Alex\'s new neighborhood well.'] },
    { ...CAR, values: ['You have a car with room for 4 people.', 'You do not have a car.'], byLimit: { no_license: 'You do not have a driver\'s license.' } }
  ],
  hackathon: [
    { id: 'skill', label: 'Your skills', kw: ['skill', 'good at', 'know', 'strong', 'language', 'frontend', 'backend'], values: ['You are strongest at frontend and design.', 'You are strongest at backend and databases.', 'You have built a few small machine learning projects.'], byLimit: { new_python: 'You only know JavaScript.' } },
    { id: 'laptop', label: 'Your laptop', kw: ['laptop', 'mac', 'windows', 'computer'], values: ['You have a MacBook.', 'You have a Windows laptop.'], byLimit: { no_mac: 'You have a Windows laptop.' } }
  ],
  concert: [
    { id: 'music', label: 'Your music', kw: ['music', 'into', 'fan', 'listen'], values: ['You love pop music.', 'You are into indie bands.', 'You like jazz and any live music.'] },
    { ...CAR, values: ['You have a car with room for 4 people.', 'You do not have a car.'], byLimit: { no_car: 'You have a car, but you do not drive at night.' } }
  ],
  housing: [
    { id: 'now', label: 'Where you live now', kw: ['live', 'now', 'currently'], values: ['You live in the dorms this year.', 'You live in University City now.'] },
    { ...CAR, values: ['You have a car.', 'You do not have a car.'], byLimit: noCar('no_car') }
  ],
  volunteer: [
    { id: 'done', label: 'Volunteering before', kw: ['volunteer', 'experience', 'before', 'done this'], values: ['You volunteered at a food bank in high school.', 'You have tutored middle schoolers.', 'You have never volunteered before.'] },
    { ...CAR, values: ['You have a car with room for 4 people.', 'You do not have a car.'], byLimit: noCar('carsick') }
  ]
};

// One seat that has a role in the scenario, given to the first person (people before AI players) whose limit allows it.
export const ROLE = {
  beachhouse: { avoid: ['cannot_front'], mine: 'You found the house and you are the one in touch with the host.', other: (name) => `${name} found the house and is in touch with the host.` }
};

// ---------- who owes what ----------
// A task with a bill can show a "who owes what" card once the parts it needs are decided, and people can pay their
// share through the AI (a demo: no money moves). seats: [{ pcode, name, fact(id) => value, role }].
// Returns { title, rows: [{ pcode, amount, to, toName, note }], method, notes } or { missing: [part ids] }.
const money = (x) => Math.round(x * 100) / 100;
export const BILLS = {
  beachhouse: {
    needs: ['split', 'payer', 'groceries', 'app'],
    compute(plan, seats) {
      const RENT = 600, GROCERY = 120;
      const host = seats.find((s) => s.role) || seats[0];
      const weight = (s) => (plan.split === 'nights' ? s.fact('nights')?.n || 2 : plan.split === 'rooms' ? s.fact('room')?.w || 1 : 1);
      const total = seats.reduce((a, s) => a + weight(s), 0);
      const rows = [];
      for (const s of seats) {
        const rent = money((RENT * weight(s)) / total);
        const food = plan.groceries === 'shared' ? money(GROCERY / seats.length) : 0;
        const why = plan.split === 'nights' ? `${weight(s)} night${weight(s) === 1 ? '' : 's'}` : plan.split === 'rooms' ? (s.fact('room')?.text.replace(/^You (took |have |are sleeping on )?/, '').replace(/\.$/, '') || 'room') : 'even share';
        if (plan.payer === 'one') {
          if (s === host) continue; // the host paid the house up front; everyone else pays them back
          rows.push({ pcode: s.pcode, amount: money(rent + food), to: host.pcode, note: `Rent (${why})${food ? ' + groceries' : ''}` });
        } else {
          rows.push({ pcode: s.pcode, amount: rent, to: 'host', toName: 'the house owner', note: `Rent (${why})` });
          if (food && s !== host) rows.push({ pcode: s.pcode, amount: food, to: host.pcode, note: 'Groceries' });
        }
      }
      const notes = [plan.payer === 'one' ? `${host.name} pays the $${RENT} rent up front${plan.groceries === 'shared' ? ' and does the $120 grocery run' : ''}; everyone else pays them back.` : `Everyone pays the house owner their part of the $${RENT} rent${plan.groceries === 'shared' ? `, and ${host.name} does the $${GROCERY} grocery run` : ''}.`];
      const own = money((RENT * weight(host)) / total + (plan.groceries === 'shared' ? GROCERY / seats.length : 0));
      if (plan.payer === 'one') notes.push(`${host.name}'s own share is $${own.toFixed(2)}, so ${host.name} paid that part already.`);
      if (plan.groceries === 'eatout') notes.push('Meals out are paid at each meal, so they are not on this bill.');
      return { title: 'Beach house: who owes what', rows, method: plan.app, notes };
    }
  }
};

// "You are staying both nights." -> "i'm staying both nights.": how an AI player says one of its facts.
export function firstPerson(text) {
  return String(text).replace(/^You are\b/, "i'm").replace(/^You have\b/, 'i have').replace(/^You can\b/, 'i can').replace(/^You\b/, 'i')
    .replace(/\byour\b/gi, 'my').replace(/\byou\b/gi, 'me').replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase());
}
