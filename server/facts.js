// Basic facts about each seat: everyday details a person would know about themselves in the scenario ("you are
// staying both nights", "you have a car"). They give everyone, people and AI players alike, something concrete to say.
// Unlike the private limit, these are fine to share. A fact that follows from a limit (a one-night limit means you
// stay one night) is set by that limit, so facts never contradict limits; such a fact is marked private, because
// saying it gives the limit away.
// Each value is a sentence in the second person, or { text, ...numbers the bill uses }. Values are dealt like
// limits: shuffled per table, so people at one table differ.

// Every fact has at least 4 versions, so no two people at a table of 4 share one. A limit's version is worded
// differently from all of them.
const CAR = { id: 'car', label: 'Car', kw: ['car', 'drive', 'driving', 'pick up', 'pick you', 'a ride'],
  values: ['You have a car with room for 4 people.', 'You have a small car with room for 1 more person.', 'You do not have a car, but you have a bike.', 'You do not have a car and usually take the bus.'] };
const noCar = (...ids) => Object.fromEntries(ids.map((id) => [id, 'You do not have a car, and long car rides make you sick.']));
const f = (id, label, kw, values, byLimit) => ({ id, label, kw, values, ...(byLimit ? { byLimit } : {}) });

export const FACTS = {
  outing: [
    { ...CAR, byLimit: noCar('no_car') },
    f('home', 'Where you live', ['live', 'coming from', 'far from', 'where are you'], ['You live on campus, a 5 minute walk from the trolley.', 'You live in University City, near a bus stop.', 'You live in Pacific Beach, 25 minutes from campus.', 'You live in Clairemont, 15 minutes from campus by car.'])
  ],
  project: [
    f('strength', 'What you are good at', ['good at', 'strength', 'skill', 'role', 'best at'], ['You are good at research and finding sources.', 'You like writing and editing.', 'You are good at organizing and keeping deadlines.', 'You are good at making charts and figures.'], { slides_person: 'You are the fastest at slides, and writing is your weak spot.' }),
    f('free', 'When you are free', ['free', 'schedule', 'available', 'when can you'], ['You are free most evenings.', 'You are free Monday and Thursday evenings.', 'You are free Tuesday and Wednesday evenings.', 'You are free in the mornings before 11.'], { lab_wed: 'You are free Monday and Thursday evenings; Wednesday afternoons you are in a lab.', away_thu: 'You are free Monday and Wednesday evenings; Thursday you are away.' })
  ],
  event: [
    f('role', 'Your role in the club', ['role', 'position', 'what do you do'], ['You run the club Instagram.', 'You are the club vice president.', 'You joined the club last quarter.', 'You are on the events committee.'], { club_40: 'You are the club treasurer and you track the budget.' }),
    f('bring', 'What you can bring', ['bring', 'own', 'projector', 'games', 'cook'], ['You own a big board game collection.', 'You can borrow a projector and speakers.', 'You love cooking for groups.', 'You can bring folding chairs and a cooler.'])
  ],
  dinner: [
    f('diet', 'What you eat', ['eat', 'diet', 'vegetarian', 'allerg', 'food'], ['You eat everything.', 'You love spicy food.', 'You do not eat pork.', 'You are trying to eat less meat, but you eat everything.'], { veg: 'You are vegetarian, and you have been for years.' }),
    { ...CAR, byLimit: noCar('no_car') }
  ],
  study: [
    f('home', 'Where you live', ['live', 'commute', 'far', 'coming from'], ['You live on campus, next to Geisel.', 'You live in University City, a short bus ride away.', 'You live in La Jolla, 10 minutes by bus.', 'You live on campus, near Price Center.'], { commute: 'You live 45 minutes away by bus.' }),
    f('prep', 'How prepared you are', ['material', 'lecture', 'understand', 'flashcards', 'behind', 'prepared', 'ready'], ['You understand the first half of the material well.', 'You are behind on the last two lectures.', 'You made a big set of flashcards.', 'You have last year\'s practice midterm.'])
  ],
  trip: [
    { ...CAR, values: ['You have a car with room for 5 people.', 'You have a small car with room for 2 more people.', 'You do not have a car, but you can rent one.', 'You do not have a car or a license.'], byLimit: noCar('carsick') },
    f('been', 'Places you have been', ['been', 'visited', 'ever gone', 'been to'], ['You have been to Los Angeles many times.', 'You have never been to Joshua Tree.', 'You went to Big Bear last winter.', 'You have family in Temecula.'])
  ],
  roommates: [
    f('schedule', 'Your schedule', ['schedule', 'sleep', 'wake', 'bed', 'night owl', 'morning'], ['You are a night owl and study late.', 'You work weekend mornings.', 'You have a 9 am class most days.', 'You work evenings at a cafe on campus.'], { early_lab: 'You have a 7 am lab every weekday and go to bed early.', travel: 'You travel for work every other week.' }),
    f('cook', 'Cooking', ['cook', 'groceries', 'meal'], ['You cook most nights.', 'You mostly eat on campus.', 'You meal prep on Sundays.', 'You bake a lot on weekends.'], { diet: 'You cook vegetarian meals most nights.' })
  ],
  birthday: [
    f('sam', 'You and Sam', ['know sam', 'sam', 'friends'], ['You have known Sam since first year.', 'You are Sam\'s lab partner.', 'You live next door to Sam.', 'You met Sam in a club this year.']),
    f('likes', 'What you know about Sam', ['like', 'likes', 'into', 'enjoy', 'favorite'], ['Sam loves trying new restaurants.', 'Sam is really into puzzles.', 'Sam is a big foodie.', 'Sam loves anything with a group of friends.'])
  ],
  potluck: [
    f('cook', 'What you can make', ['cook', 'make', 'bring', 'dish'], ['You make a great mac and cheese.', 'You do not cook much, but you can buy drinks.', 'You can make guacamole and salsa.', 'You can bake a pie.']),
    f('home', 'Where you live', ['live', 'apartment', 'place', 'oven', 'kitchen'], ['You live in a shared apartment near campus.', 'You live in the dorms.', 'You live in a studio with a tiny kitchen.', 'You live with your family, 20 minutes away.'], { no_oven: 'You checked the apartment you could use: its oven is broken.' })
  ],
  meeting: [
    f('time', 'On the team', ['team', 'how long', 'joined'], ['You have been on the team for a year.', 'You joined the team last month.', 'You write the weekly report.', 'You train the new hires.']),
    f('where', 'Where you work', ['office', 'remote', 'work from', 'where do you work'], ['You work from the office near campus.', 'You split your time between home and the office.', 'You work from the office three days a week.', 'You mostly work from home in San Diego.'], { remote: 'You work fully remote from Los Angeles.' })
  ],
  sports: [
    f('played', 'Sports you have played', ['played', 'play', 'experience', 'sport'], ['You played basketball in high school.', 'You played club volleyball.', 'You have played ultimate frisbee a few times.', 'You ran track in high school.']),
    f('free', 'When you are free', ['free', 'schedule', 'available'], ['You are free most evenings.', 'You are free Tuesday and Thursday evenings.', 'You are free on weekends.', 'You are free Thursday evenings and Saturdays.'], { work_tue: 'You work Tuesday evenings, so you are free other nights.', class_8: 'You have an 8 am class every day, even Saturday.' })
  ],
  gaming: [
    f('has', 'What you own', ['own', 'switch', 'console', 'pc', 'games', 'controllers'], ['You own a Nintendo Switch with four controllers.', 'You have a gaming PC.', 'You own Catan and a few card games.', 'You have a PlayStation and a big TV.'], { weak_laptop: 'You own a few card games; your laptop is old and slow.' }),
    f('home', 'Where you live', ['live', 'apartment', 'place', 'come over'], ['You live in an apartment near UTC.', 'You live in the dorms.', 'You live in a house with three roommates.', 'You live off campus in La Jolla.'])
  ],
  beachhouse: [
    f('nights', 'Nights you are staying', ['night', 'nights', 'stay', 'staying', 'how long'], [
      { text: 'You are staying both nights, Friday and Saturday.', n: 2 }, { text: 'You arrive Friday afternoon and stay both nights.', n: 2 },
      { text: 'You stay both nights and head home Sunday morning.', n: 2 }, { text: 'You stay both nights; you are coming down Friday by train.', n: 2 }],
      { one_night: { text: 'You can only stay Saturday night.', n: 1 } }),
    f('room', 'Your room', ['room', 'bedroom', 'sleep', 'couch', 'bed'], [
      { text: 'You took the big room with its own bathroom.', w: 1.5 }, { text: 'You have a regular bedroom upstairs.', w: 1 },
      { text: 'You have the small bedroom by the kitchen.', w: 0.8 }, { text: 'You are sleeping on the pull-out couch.', w: 0.6 }]),
    f('apps', 'How you pay people', ['venmo', 'zelle', 'cash', 'what app', 'which app'], ['You use Venmo and Zelle.', 'You mostly use Venmo.', 'You mostly use Zelle through your bank.', 'You use Venmo, Zelle and Apple Pay.'], { no_venmo: 'You use Zelle; you do not have Venmo.', cash_risk: 'You use Venmo and Zelle, and you never carry cash.' })
  ],
  anniversary: [
    f('role', 'In the family', ['cousin', 'oldest', 'closest', 'family'], ['You are the oldest cousin.', 'You live closest to your grandparents.', 'You run the family group chat.', 'You are the cousin who plans every birthday.']),
    { ...CAR }
  ],
  cleanup: [
    f('role', 'Your role in the club', ['role', 'position', 'club'], ['You are the club secretary.', 'You joined the club this quarter.', 'You organized last year\'s cleanup.', 'You run the club social media.'], { club_funds: 'You are the club treasurer and you track the budget.' }),
    { ...CAR, byLimit: { no_car: 'You do not have a car, and neither do most new members.' } }
  ],
  moving: [
    f('help', 'How you can help', ['lift', 'pack', 'help', 'good at'], ['You can lift heavy furniture.', 'You are good at packing boxes neatly.', 'You know Alex\'s new neighborhood well.', 'You can assemble furniture fast.']),
    { ...CAR, byLimit: { no_license: 'You do not have a driver\'s license.' } }
  ],
  hackathon: [
    f('skill', 'Your skills', ['skill', 'good at', 'know', 'strong', 'language', 'frontend', 'backend'], ['You are strongest at frontend and design.', 'You are strongest at backend and databases.', 'You have built a few small machine learning projects.', 'You are good at pitching and demos.'], { new_python: 'You only know JavaScript, and you are new to hackathons.' }),
    f('laptop', 'Your laptop', ['laptop', 'mac', 'windows', 'computer'], ['You have a MacBook.', 'You have a new MacBook Pro.', 'You have a Windows gaming laptop.', 'You have a Linux laptop.'], { no_mac: 'You have a Windows laptop, not a Mac.' })
  ],
  concert: [
    f('music', 'Your music', ['music', 'into', 'fan', 'listen'], ['You love pop music.', 'You are into indie bands.', 'You like jazz and any live music.', 'You mostly listen to hip hop.']),
    { ...CAR, byLimit: { no_car: 'You have a car, but you do not drive at night.' } }
  ],
  housing: [
    f('now', 'Where you live now', ['live', 'now', 'currently'], ['You live in the dorms this year.', 'You live in University City now.', 'You live with your parents and commute.', 'You live in Pacific Beach now.']),
    { ...CAR, byLimit: { no_car: 'You do not have a car and need a direct bus to campus.' } }
  ],
  volunteer: [
    f('done', 'Volunteering before', ['volunteer', 'experience', 'before', 'done this'], ['You volunteered at a food bank in high school.', 'You have tutored middle schoolers.', 'You have never volunteered before.', 'You fostered a dog last year.']),
    { ...CAR, byLimit: noCar('carsick') }
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
