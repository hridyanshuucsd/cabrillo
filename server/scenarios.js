// Extra scenarios for class sessions, so every table can get a different one.
// Same shape as the tasks in tasks.js: plan fields with fixed options, five private limits, and game information.
// Every limit names the plan choices it rules out; tests/scenarios.mjs checks that at least one plan respects all five.
// Place names are real San Diego places, but every limit, price, and time is invented for play.

const o = (id, name, kw, meta) => ({ id, name, kw, ...(meta || {}) });
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A limit: re is built from words that show the person brought it up; violates lists the plan choices it rules out.
const L = (id, text, words, violates, aiPrefs, say, extra) => ({ id, text, re: new RegExp(words.map(esc).join('|'), 'i'), violates, aiPrefs, say, ...(extra || {}) });

const BUDGET_LOW_MID_HIGH = (low, mid, high, per) => ({
  id: 'budget', name: 'Budget per person', options: [
    o('low', low[0], low[1], { per: per[0] }), o('mid', mid[0], mid[1], { per: per[1] }), o('high', high[0], high[1], { per: per[2] })
  ]
});
const TRAVEL = { id: 'travel', name: 'Getting there', options: [o('transit', 'Bus or trolley', ['trolley', 'bus', 'transit', 'mts']), o('carpool', 'Carpool', ['carpool', 'drive', 'driving', 'my car']), o('rideshare', 'Rideshare', ['uber', 'lyft', 'rideshare'])] };

export const SCENARIOS = {
  dinner: {
    id: 'dinner', title: 'Pick a place for group dinner', short: 'Group dinner',
    prompt: 'Your friends want to get dinner together this weekend. Agree on where, when, and how you get there.',
    fields: [
      { id: 'where', name: 'Where', options: [o('convoy', 'Korean barbecue on Convoy Street', ['convoy', 'korean', 'kbbq', 'barbecue', 'bbq'], { fare: 20, place: 'a Korean barbecue spot on Convoy Street' }), o('littleitaly', 'Pizza in Little Italy', ['little italy', 'pizza', 'italian'], { fare: 26, place: 'a pizza place in Little Italy' }), o('hillcrest', 'Ramen in Hillcrest', ['hillcrest', 'ramen'], { fare: 24, place: 'a ramen shop in Hillcrest' }), o('pricecenter', 'Price Center food court', ['price center', 'food court', 'on campus'], { fare: 8, place: 'the Price Center food court' })] },
      { id: 'when', name: 'When', options: [o('fri6', 'Friday at 6 pm', ['friday at 6', 'friday 6', '6 pm', '6pm']), o('fri8', 'Friday at 8 pm', ['friday at 8', 'friday 8', '8 pm', '8pm']), o('sat7', 'Saturday at 7 pm', ['saturday', 'sat'])] },
      TRAVEL,
      BUDGET_LOW_MID_HIGH(['Under $15', ['under 15', 'under $15', 'cheap']], ['$15 to $30', ['$20', '$25', '15 to 30']], ['Over $30', ['$40', 'over 30', 'over $30', 'splurge']], [12, 22, 36])
    ],
    limits: [
      L('veg', 'You are vegetarian, and Korean barbecue has almost nothing you can eat.', ['vegetarian', 'veggie', 'no meat', 'meat'], (p) => p.where === 'convoy', { where: 'hillcrest' }, 'I am vegetarian, so Korean barbecue is hard for me. Ramen has veggie options.'),
      L('shift_fri', 'You work until 7 pm on Friday.', ['work until 7', 'shift', 'working friday', 'until 7'], (p) => p.when === 'fri6', { when: 'fri8' }, 'I work until 7 on Friday, so 6 pm is too early for me.'),
      L('away_sat', 'Your family is visiting all day Saturday.', ['family', 'visiting', 'saturday is out', 'busy saturday'], (p) => p.when === 'sat7', { when: 'fri8' }, 'My family is visiting on Saturday, so Friday is better.'),
      L('budget15', 'You can spend at most $15 on dinner.', ['$15', '15 dollars', 'budget', 'afford', 'broke', 'expensive', 'money'], (p) => p.budget !== 'low', { budget: 'low' }, 'Money is tight this week. I can do about 15 dollars.', { maxPerPerson: 15 }),
      L('no_car', 'You get carsick, so you can only take the bus or trolley.', ['carsick', 'car sick', 'motion sick', 'only the bus', 'only take the bus', 'trolley only'], (p) => p.travel !== 'transit', { travel: 'transit' }, 'I get carsick, so the bus or trolley works best for me.')
    ],
    info: [
      { kw: ['cost', 'price', 'expensive', 'cheap', '$', 'budget'], text: 'For this game: Price Center is about $10, ramen and pizza are about $14, and Korean barbecue is about $30 per person.' },
      { kw: ['trolley', 'bus', 'transit', 'far', 'get to'], text: 'For this game: the trolley reaches Little Italy and the bus reaches Hillcrest; Convoy Street is easiest by car.' }
    ]
  },

  study: {
    id: 'study', title: 'Set up a study session before the midterm', short: 'Study session',
    prompt: 'Your study group has a midterm next week. Agree on one study session.',
    fields: [
      { id: 'where', name: 'Where', options: [o('geisel', 'Geisel Library study room', ['geisel', 'library']), o('pc', 'Price Center tables', ['price center']), o('apt', 'Someone\'s apartment', ['apartment', 'my place', 'your place']), o('zoom', 'Online on Zoom', ['zoom', 'online', 'video call'])] },
      { id: 'when', name: 'When', options: [o('mon', 'Monday night', ['monday']), o('tue', 'Tuesday afternoon', ['tuesday']), o('wed', 'Wednesday night', ['wednesday'])] },
      { id: 'length', name: 'How long', options: [o('h1', '1 hour', ['1 hour', 'one hour', 'an hour']), o('h2', '2 hours', ['2 hours', 'two hours']), o('h3', '3 hours', ['3 hours', 'three hours'])] },
      { id: 'food', name: 'Food', options: [o('none', 'No food', ['no food']), o('pizza', 'Split a pizza', ['pizza', 'split food', 'order food']), o('own', 'Everyone brings their own', ['bring my own', 'bring your own', 'own snacks', 'own food'])] }
    ],
    limits: [
      L('commute', 'You live 45 minutes away and must catch the last bus at 9 pm, so you cannot stay on campus at night.', ['45 minutes', 'last bus', 'live far', 'commute', 'catch the bus'], (p) => p.where !== 'zoom' && (p.when === 'mon' || p.when === 'wed'), { where: 'zoom' }, 'I live 45 minutes away and the last bus is at 9, so a night session would need to be online for me.'),
      L('work_tue', 'You work every Tuesday afternoon.', ['tuesday', 'work tuesday', 'shift'], (p) => p.when === 'tue', { when: 'mon' }, 'I work Tuesday afternoons, so not then.'),
      L('noise', 'You cannot focus in loud places, and Price Center is very loud.', ['loud', 'noisy', 'noise', 'focus'], (p) => p.where === 'pc', { where: 'geisel' }, 'Price Center is too loud for me to focus.'),
      L('broke', 'You cannot spend any money this week.', ['money', 'broke', 'spend', 'afford', 'budget'], (p) => p.food === 'pizza', { food: 'own' }, 'I cannot spend money this week, so I would rather everyone brings their own food.'),
      L('two_hours', 'You can study for at most 2 hours before you stop absorbing anything.', ['2 hours', 'two hours', 'too long', 'max'], (p) => p.length === 'h3', { length: 'h2' }, 'Three hours is too long for me. Two hours at most.')
    ],
    info: [
      { kw: ['geisel', 'library', 'room', 'book'], text: 'For this game: Geisel study rooms can be booked for up to 3 hours and close at midnight.' },
      { kw: ['bus', 'late', 'night', 'commute'], text: 'For this game: the last bus from campus to most neighborhoods leaves around 9 pm.' }
    ]
  },

  trip: {
    id: 'trip', title: 'Plan a weekend trip out of town', short: 'Weekend trip',
    prompt: 'Your group wants to get out of San Diego for a weekend. Agree on the trip.',
    fields: [
      { id: 'where', name: 'Where', options: [o('la', 'Los Angeles', ['los angeles', 'la ', 'santa monica'], { fare: 60, place: 'a restaurant in Los Angeles' }), o('jtree', 'Joshua Tree', ['joshua tree', 'desert'], { fare: 120, place: 'a diner near Joshua Tree' }), o('bigbear', 'Big Bear', ['big bear', 'mountains', 'snow'], { fare: 110, place: 'a cafe in Big Bear' }), o('temecula', 'Temecula', ['temecula'], { fare: 70, place: 'a restaurant in Temecula' })] },
      { id: 'stay', name: 'Stay', options: [o('daytrip', 'Day trip, no overnight', ['day trip', 'no overnight', 'same day', 'come back']), o('airbnb', 'One night in an Airbnb', ['airbnb', 'rental', 'house']), o('camp', 'Camping', ['camp', 'tent'])] },
      { id: 'transport', name: 'Getting there', options: [o('amtrak', 'Amtrak train', ['amtrak', 'train']), o('rental', 'Rent a car', ['rent a car', 'rental car', 'rent']), o('carpool', 'Carpool in a friend\'s car', ['carpool', 'my car', 'drive'])] },
      BUDGET_LOW_MID_HIGH(['Under $60', ['under 60', 'under $60', 'cheap']], ['$60 to $120', ['$100', '60 to 120']], ['Over $120', ['over 120', 'over $120', '$200']], [50, 90, 160])
    ],
    limits: [
      L('pet', 'You have a new puppy that cannot be left alone overnight.', ['puppy', 'dog', 'pet', 'overnight'], (p) => p.stay !== 'daytrip', { stay: 'daytrip' }, 'I have a new puppy, so I cannot stay overnight. Could we do a day trip?'),
      L('budget60', 'You can spend at most $60 on the whole trip.', ['$60', '60 dollars', 'budget', 'afford', 'expensive', 'money', 'cheap'], (p) => p.budget !== 'low', { budget: 'low' }, 'I can only spend about 60 dollars on this.', { maxPerPerson: 60 }),
      L('carsick', 'You get very carsick on long drives.', ['carsick', 'car sick', 'long drive', 'motion sick'], (p) => p.transport !== 'amtrak', { transport: 'amtrak' }, 'Long drives make me carsick. The train would be much better for me.'),
      L('chains', 'You checked: Big Bear roads need snow chains this weekend, and nobody has them.', ['chains', 'snow', 'big bear'], (p) => p.where === 'bigbear', { where: 'la' }, 'Heads up, Big Bear needs snow chains this weekend and none of us have them.'),
      L('no_tent', 'You do not own a tent or sleeping bag and cannot borrow one.', ['tent', 'sleeping bag', 'camping'], (p) => p.stay === 'camp', { stay: 'daytrip' }, 'I do not have a tent or a sleeping bag, so camping is hard for me.')
    ],
    info: [
      { kw: ['train', 'amtrak', 'get to', 'far'], text: 'For this game: Amtrak goes to Los Angeles only; Joshua Tree, Big Bear, and Temecula need a car.' },
      { kw: ['cost', 'price', 'expensive', 'cheap', '$', 'budget'], text: 'For this game: an Amtrak round trip to LA is about $40, a rental car is about $60 a day, and an Airbnb is about $50 per person.' }
    ]
  },

  roommates: {
    id: 'roommates', title: 'Agree on house rules with your roommates', short: 'Roommate rules',
    prompt: 'You are moving into an apartment together. Agree on a few house rules.',
    fields: [
      { id: 'clean', name: 'Cleaning', options: [o('chart', 'Weekly chore chart', ['chart', 'rotate', 'rotation', 'weekly']), o('own', 'Everyone cleans their own mess', ['own mess', 'clean up after', 'own dishes']), o('cleaner', 'Hire a cleaner and split it', ['cleaner', 'hire'])] },
      { id: 'quiet', name: 'Quiet hours', options: [o('q10', 'From 10 pm', ['10 pm', '10pm', 'ten']), o('q12', 'From midnight', ['midnight', '12 am', '12am']), o('qnone', 'No quiet hours', ['no quiet hours', 'no rule'])] },
      { id: 'guests', name: 'Guests', options: [o('any', 'Anytime', ['anytime', 'any time', 'whenever']), o('weekend', 'Weekends only', ['weekends only', 'only weekends', 'weekend']), o('ask', 'Ask the group first', ['ask first', 'ask the group', 'check first'])] },
      { id: 'food', name: 'Groceries', options: [o('split', 'Split all groceries', ['split all', 'split everything', 'share all']), o('basics', 'Share basics only', ['basics', 'shared basics', 'oil', 'toilet paper']), o('separate', 'Everyone buys their own', ['buy my own', 'buys their own', 'separate'])] }
    ],
    limits: [
      L('no_money', 'You cannot afford to pay for a cleaner.', ['afford', 'money', 'cleaner', 'expensive', 'budget'], (p) => p.clean === 'cleaner', { clean: 'own' }, 'I cannot really afford a cleaner.'),
      L('early_lab', 'You have a 7 am lab every weekday and go to bed early.', ['7 am', '7am', 'early', 'bed', 'sleep'], (p) => p.quiet !== 'q10', { quiet: 'q10' }, 'I have a 7 am lab every day, so I need quiet by 10.'),
      L('partner', 'Your partner visits on weekday evenings.', ['partner', 'boyfriend', 'girlfriend', 'weekday'], (p) => p.guests === 'weekend', { guests: 'ask' }, 'My partner usually visits on weekday evenings, so weekends only would not work for me.'),
      L('travel', 'You travel for work every other week, so a weekly chore chart would not work.', ['travel', 'every other week', 'away', 'gone'], (p) => p.clean === 'chart', { clean: 'own' }, 'I travel every other week for work, so a weekly chart is hard for me.'),
      L('diet', 'You keep a vegetarian kitchen and do not want to share meat-heavy groceries.', ['vegetarian', 'meat', 'veggie', 'diet'], (p) => p.food === 'split', { food: 'basics' }, 'I am vegetarian, so splitting every grocery would not really work. Basics only?')
    ],
    info: [
      { kw: ['cleaner', 'cost', 'price', '$'], text: 'For this game: a cleaner costs about $120 a month, about $30 each for four people.' },
      { kw: ['lease', 'rule', 'quiet', 'guest'], text: 'For this game: the lease sets no quiet hours or guest rules, so it is up to you.' }
    ]
  },

  birthday: {
    id: 'birthday', title: 'Plan a surprise birthday for a friend', short: 'Surprise birthday',
    prompt: 'Your friend Sam turns 21 next week. Plan a surprise together.',
    fields: [
      { id: 'what', name: 'Activity', options: [o('dinner', 'Dinner out', ['dinner', 'restaurant']), o('party', 'House party', ['house party', 'party']), o('karaoke', 'Karaoke', ['karaoke', 'singing']), o('escape', 'Escape room', ['escape room', 'escape'])] },
      { id: 'when', name: 'When', options: [o('fri', 'Friday night', ['friday']), o('sat', 'Saturday night', ['saturday']), o('sun', 'Sunday afternoon', ['sunday'])] },
      { id: 'gift', name: 'Gift', options: [o('group', 'One group gift', ['group gift', 'chip in', 'one gift']), o('each', 'Everyone brings their own', ['own gift', 'individual', 'each bring']), o('nogift', 'No gifts, just the plan', ['no gift', 'no gifts'])] },
      BUDGET_LOW_MID_HIGH(['Under $20', ['under 20', 'under $20', 'cheap']], ['$20 to $40', ['$30', '20 to 40']], ['Over $40', ['$50', 'over 40', 'over $40']], [15, 30, 50])
    ],
    limits: [
      L('budget20', 'You can spend at most $20 in total, including any gift.', ['$20', '20 dollars', 'budget', 'afford', 'money', 'expensive'], (p) => p.budget !== 'low' || p.gift === 'each', { budget: 'low', gift: 'group' }, 'I can only spend about 20 dollars total, gift included.', { maxPerPerson: 20 }),
      L('hates_singing', 'Sam told you they hate singing in public.', ['singing', 'karaoke', 'hates'], (p) => p.what === 'karaoke', { what: 'dinner' }, 'Sam told me they really hate singing in public, so not karaoke.'),
      L('sam_sat', 'Sam already has plans with family on Saturday.', ['saturday', 'family', 'plans'], (p) => p.when === 'sat', { when: 'fri' }, 'Sam is with family on Saturday, so that day will not work.'),
      L('work_sun', 'You work every Sunday.', ['sunday', 'work', 'shift'], (p) => p.when === 'sun', { when: 'fri' }, 'I work Sundays, so not then.'),
      L('no_host', 'None of your group\'s apartments allow parties. You checked with everyone.', ['apartment', 'host', 'landlord', 'lease', 'party', 'parties'], (p) => p.what === 'party', { what: 'dinner' }, 'None of our places allow parties, I checked.')
    ],
    info: [
      { kw: ['cost', 'price', 'expensive', '$', 'budget', 'escape'], text: 'For this game: an escape room is about $35 per person, karaoke about $15, and dinner about $15 to $30.' }
    ]
  },

  potluck: {
    id: 'potluck', title: 'Organize a Friendsgiving potluck', short: 'Friendsgiving',
    prompt: 'Your friends are hosting Friendsgiving before the break. Agree on the plan.',
    fields: [
      { id: 'main', name: 'Main dish', options: [o('turkey', 'Roast turkey', ['turkey']), o('lasagna', 'Lasagna', ['lasagna']), o('tacos', 'Taco bar', ['taco'])] },
      { id: 'where', name: 'Where', options: [o('apt', 'Someone\'s apartment', ['apartment', 'my place'], { fare: 14, place: 'a pizza place nearby' }), o('park', 'Picnic at Balboa Park', ['park', 'picnic', 'balboa'], { fare: 18, place: 'a cafe in Balboa Park' }), o('clubroom', 'Club room on campus', ['club room', 'campus'], { fare: 8, place: 'a pizza place near campus' })] },
      { id: 'when', name: 'When', options: [o('thu', 'Thursday evening', ['thursday']), o('sat', 'Saturday afternoon', ['saturday']), o('sun', 'Sunday evening', ['sunday'])] },
      { id: 'drinks', name: 'Drinks', options: [o('bring', 'Everyone brings some', ['everyone brings', 'bring drinks', 'bring some']), o('front', 'One person buys and we split', ['one person buys', 'venmo', 'split it', 'pay back']), o('nodrinks', 'Just water', ['just water', 'no drinks', 'water'])] }
    ],
    limits: [
      L('flight', 'You fly home Thursday morning.', ['fly', 'flight', 'thursday', 'leaving'], (p) => p.when === 'thu', { when: 'sat' }, 'I fly home Thursday morning, so a Thursday dinner will not work for me.'),
      L('no_oven', 'You checked: the only apartment you could use has no working oven.', ['oven', 'no oven', 'bake'], (p) => p.where === 'apt' && (p.main === 'turkey' || p.main === 'lasagna'), { main: 'tacos' }, 'The apartment has no working oven, so a turkey or lasagna there will not work.'),
      L('rain', 'Rain is forecast all weekend.', ['rain', 'weather', 'forecast'], (p) => p.where === 'park' && p.when !== 'thu', { where: 'apt' }, 'Rain is forecast all weekend, so a picnic is risky.'),
      L('cannot_front', 'You cannot pay up front and wait to be paid back.', ['pay up front', 'front', 'pay back', 'venmo', 'money'], (p) => p.drinks === 'front', { drinks: 'bring' }, 'I cannot really pay up front and wait to be paid back.'),
      L('clubroom_sun', 'The club room closes at 5 pm on Sundays.', ['club room', 'closes', 'sunday'], (p) => p.where === 'clubroom' && p.when === 'sun', { where: 'apt' }, 'The club room closes at 5 on Sundays.')
    ],
    info: [
      { kw: ['oven', 'kitchen', 'cook'], text: 'For this game: turkey and lasagna need an oven; a taco bar only needs a stove.' },
      { kw: ['club room', 'room', 'campus'], text: 'For this game: the club room is free on Saturday and Sunday, and has no kitchen.' }
    ]
  },

  meeting: {
    id: 'meeting', title: 'Set a weekly meeting for your work team', short: 'Team meeting',
    prompt: 'Your part-time work team needs one weekly meeting. Agree on how it runs.',
    fields: [
      { id: 'day', name: 'Day', options: [o('mon', 'Monday', ['monday']), o('wed', 'Wednesday', ['wednesday']), o('fri', 'Friday', ['friday'])] },
      { id: 'time', name: 'Time', options: [o('t8', '8 am', ['8 am', '8am', 'morning']), o('t12', 'Noon', ['noon', 'lunch', '12']), o('t5', '5 pm', ['5 pm', '5pm', 'evening', 'after work'])] },
      { id: 'format', name: 'Format', options: [o('person', 'In person', ['in person', 'office', 'face to face']), o('video', 'Video call', ['video', 'zoom', 'teams', 'call']), o('thread', 'Chat thread only', ['thread', 'slack', 'async', 'written'])] },
      { id: 'notes', name: 'Who takes notes', options: [o('rotate', 'Rotate each week', ['rotate', 'take turns']), o('one', 'One volunteer every week', ['volunteer', 'one person']), o('lead', 'The team lead', ['team lead', 'manager', 'lead'])] }
    ],
    limits: [
      L('dropoff', 'You drop your little brother at school at 8 am.', ['brother', 'school', 'drop', '8 am', '8am', 'morning'], (p) => p.time === 't8', { time: 't12' }, 'I drop my brother at school at 8, so mornings do not work.'),
      L('class_wed', 'You have a class every Wednesday at noon and at 5 pm.', ['class', 'wednesday'], (p) => p.day === 'wed' && p.time !== 't8', { day: 'mon' }, 'Wednesdays I have class at noon and at 5.'),
      L('remote', 'You work fully remote from Los Angeles.', ['remote', 'los angeles', ' la ', 'not in town', 'in person'], (p) => p.format === 'person', { format: 'video' }, 'I am remote in LA, so in person would leave me out.'),
      L('notes_burden', 'You were the only note taker at your last job, and you do not want that again.', ['note taker', 'notes', 'always me', 'every week'], (p) => p.notes === 'one', { notes: 'rotate' }, 'I was always stuck taking notes at my last job. Could we rotate?'),
      L('lead_out', 'The team lead told you they are on leave for the next month.', ['team lead', 'leave', 'out for a month'], (p) => p.notes === 'lead', { notes: 'rotate' }, 'The team lead is on leave for a month, so they cannot take notes.')
    ],
    info: [
      { kw: ['thread', 'async', 'written'], text: 'For this game: a chat thread works for updates but is slow for decisions.' }
    ]
  },

  sports: {
    id: 'sports', title: 'Start an intramural team', short: 'Intramural team',
    prompt: 'Your friends are signing up for intramurals this quarter. Agree on the team plan.',
    fields: [
      { id: 'sport', name: 'Sport', options: [o('basketball', 'Basketball', ['basketball', 'hoops']), o('volleyball', 'Volleyball', ['volleyball']), o('soccer', 'Soccer', ['soccer', 'football']), o('ultimate', 'Ultimate frisbee', ['ultimate', 'frisbee'])] },
      { id: 'day', name: 'Game day', options: [o('tue', 'Tuesday', ['tuesday']), o('thu', 'Thursday', ['thursday']), o('sat', 'Saturday', ['saturday'])] },
      { id: 'time', name: 'Time', options: [o('morning', 'Morning', ['morning', 'am']), o('evening', 'Evening', ['evening', 'night', 'pm'])] },
      { id: 'shirts', name: 'Jerseys', options: [o('buy', 'Buy matching shirts ($20)', ['buy shirts', 'matching', 'jerseys', 'custom']), o('color', 'Everyone wears the same color', ['same color', 'wear black', 'wear blue']), o('none', 'No jerseys', ['no jerseys', 'no shirts'])] }
    ],
    limits: [
      L('new_soccer', 'You have never played soccer and are nervous about it.', ['soccer', 'never played', 'nervous'], (p) => p.sport === 'soccer', { sport: 'basketball' }, 'I have never played soccer, so I would rather do something else.'),
      L('work_tue', 'You work Tuesday evenings.', ['tuesday', 'work'], (p) => p.day === 'tue' && p.time === 'evening', { day: 'thu' }, 'I work Tuesday evenings.'),
      L('class_8', 'You have an 8 am class every day, Saturday included.', ['8 am', '8am', 'morning', 'class'], (p) => p.time === 'morning', { time: 'evening' }, 'I have 8 am classes, even on Saturday, so mornings are out.'),
      L('no_money', 'You cannot spend money on shirts this quarter.', ['money', 'afford', '$20', 'spend', 'expensive'], (p) => p.shirts === 'buy', { shirts: 'color' }, 'I cannot spend 20 dollars on a shirt this quarter.'),
      L('courts', 'You checked: the volleyball courts are booked on Thursdays.', ['booked', 'courts', 'volleyball'], (p) => p.sport === 'volleyball' && p.day === 'thu', { sport: 'basketball' }, 'The volleyball courts are booked on Thursdays.')
    ],
    info: [
      { kw: ['sign up', 'deadline', 'register'], text: 'For this game: intramural sign-ups close Friday and each team needs a captain.' }
    ]
  },

  gaming: {
    id: 'gaming', title: 'Plan a game night', short: 'Game night',
    prompt: 'Your friends want a game night this week. Agree on what, when, and where.',
    fields: [
      { id: 'game', name: 'Game', options: [o('mariokart', 'Mario Kart', ['mario', 'kart', 'switch']), o('valorant', 'Valorant', ['valorant', 'shooter']), o('board', 'Board games', ['board game', 'catan', 'cards']), o('minecraft', 'Minecraft', ['minecraft'])] },
      { id: 'where', name: 'Where', options: [o('online', 'Online from home', ['online', 'discord', 'from home']), o('apt', 'Someone\'s apartment', ['apartment', 'my place', 'come over'], { fare: 14, place: 'a pizza place nearby' }), o('pc', 'Game room in Price Center', ['price center', 'game room'], { fare: 8, place: 'a pizza place near campus' })] },
      { id: 'when', name: 'When', options: [o('wed', 'Wednesday night', ['wednesday']), o('fri', 'Friday night', ['friday']), o('sun', 'Sunday afternoon', ['sunday'])] },
      { id: 'snacks', name: 'Snacks', options: [o('split', 'Order food and split', ['order', 'split', 'delivery', 'doordash']), o('bring', 'Everyone brings something', ['bring', 'potluck']), o('none', 'No snacks', ['no snacks', 'no food'])] }
    ],
    limits: [
      L('weak_laptop', 'Your laptop cannot run Valorant or Minecraft.', ['laptop', 'cannot run', 'computer', 'pc'], (p) => p.game === 'valorant' || p.game === 'minecraft', { game: 'board' }, 'My laptop cannot run Valorant or Minecraft.'),
      L('wifi', 'Your apartment wifi is too slow for online games.', ['wifi', 'internet', 'lag', 'slow'], (p) => p.where === 'online', { where: 'pc' }, 'My wifi is too slow to play online.'),
      L('fri_shift', 'You work Friday nights.', ['friday', 'work', 'shift'], (p) => p.when === 'fri', { when: 'wed' }, 'I work Friday nights.'),
      L('broke', 'You cannot spend money on food this week.', ['money', 'afford', 'spend', 'broke', 'expensive'], (p) => p.snacks === 'split', { snacks: 'bring' }, 'I cannot spend money on food this week.'),
      L('pc_sunday', 'You checked: the Price Center game room is closed on Sundays.', ['closed', 'sunday', 'game room'], (p) => p.where === 'pc' && p.when === 'sun', { when: 'wed' }, 'The Price Center game room is closed on Sundays.')
    ],
    info: [
      { kw: ['game room', 'price center', 'switch', 'console'], text: 'For this game: the Price Center game room has Switch consoles and board games and is free for students.' }
    ]
  },

  beachhouse: {
    id: 'beachhouse', title: 'Split the costs of a beach house weekend', short: 'Beach house costs',
    prompt: 'Your group rented a beach house in Oceanside for two nights. Agree on how to split the costs.',
    fields: [
      { id: 'split', name: 'Split the rent', options: [o('even', 'Evenly', ['evenly', 'even split', 'equal']), o('nights', 'By nights stayed', ['by night', 'nights stayed', 'per night']), o('rooms', 'By room size', ['room size', 'bigger room', 'master'])] },
      { id: 'app', name: 'Pay with', options: [o('venmo', 'Venmo', ['venmo']), o('zelle', 'Zelle', ['zelle']), o('cash', 'Cash', ['cash'])] },
      { id: 'payer', name: 'Who pays the host', options: [o('one', 'One person pays, others pay them back', ['one person', 'pay back', 'front']), o('each', 'Everyone pays the host directly', ['pay directly', 'each pay', 'directly'])] },
      { id: 'groceries', name: 'Groceries', options: [o('shared', 'One shared grocery run, split evenly', ['shared', 'grocery run', 'split groceries']), o('own', 'Everyone buys their own', ['own food', 'buy my own']), o('eatout', 'Eat out every meal', ['eat out', 'restaurants'])] }
    ],
    limits: [
      L('one_night', 'You can only stay one of the two nights.', ['one night', 'only stay', 'leave early', 'saturday only'], (p) => p.split === 'even', { split: 'nights' }, 'I can only stay one night, so splitting evenly feels unfair to me.'),
      L('no_venmo', 'You do not have Venmo and do not want to make an account.', ['venmo', 'no app', 'account'], (p) => p.app === 'venmo', { app: 'zelle' }, 'I do not have Venmo.'),
      L('cannot_front', 'You cannot pay up front for everyone.', ['front', 'pay up front', 'cannot pay', 'money'], (p) => p.payer === 'one', { payer: 'each' }, 'I cannot front the money for everyone.'),
      L('cash_risk', 'You never carry cash.', ['cash', 'atm'], (p) => p.app === 'cash', { app: 'zelle' }, 'I never carry cash.'),
      L('eatout_budget', 'You cannot afford to eat out every meal.', ['eat out', 'restaurants', 'afford', 'expensive', 'budget'], (p) => p.groceries === 'eatout', { groceries: 'shared' }, 'Eating out every meal is too expensive for me.')
    ],
    info: [
      { kw: ['cost', 'price', 'rent', '$', 'total'], text: 'For this game: the house costs $600 for two nights; host fees are the same whoever pays.' }
    ]
  },

  anniversary: {
    id: 'anniversary', title: 'Plan your grandparents\' anniversary dinner', short: 'Family dinner',
    prompt: 'You and your cousins are planning a 50th anniversary dinner for your grandparents. Agree on the plan.',
    fields: [
      { id: 'where', name: 'Restaurant', options: [o('italian', 'Italian in Little Italy', ['italian', 'little italy'], { fare: 26, place: 'an Italian restaurant in Little Italy' }), o('dimsum', 'Dim sum on Convoy Street', ['dim sum', 'convoy', 'chinese'], { fare: 20, place: 'a dim sum restaurant on Convoy Street' }), o('mexican', 'Mexican in Old Town', ['mexican', 'old town'], { fare: 18, place: 'a Mexican restaurant in Old Town' })] },
      { id: 'when', name: 'When', options: [o('sat_lunch', 'Saturday lunch', ['saturday lunch', 'lunch']), o('sat_dinner', 'Saturday dinner', ['saturday dinner', 'saturday night']), o('sun_lunch', 'Sunday lunch', ['sunday'])] },
      { id: 'gift', name: 'Gift', options: [o('album', 'A photo album', ['album', 'photos']), o('flowers', 'Flowers', ['flowers']), o('trip', 'A weekend trip voucher', ['trip', 'voucher', 'getaway'])] },
      { id: 'ride', name: 'Getting them there', options: [o('cousin', 'A cousin drives them', ['drive them', 'pick them up', 'cousin drives']), o('rideshare', 'Book them a rideshare', ['uber', 'lyft', 'rideshare']), o('selfdrive', 'They drive themselves', ['drive themselves', 'they drive'])] }
    ],
    limits: [
      L('grandpa_night', 'Your grandpa does not like driving or being out after dark.', ['dark', 'night', 'evening', 'after dark'], (p) => p.when === 'sat_dinner' || p.ride === 'selfdrive', { when: 'sat_lunch' }, 'Grandpa does not like being out after dark or driving, so lunch would be better.'),
      L('spicy', 'Your grandma avoids spicy food.', ['spicy', 'grandma', 'mild'], (p) => p.where === 'mexican', { where: 'italian' }, 'Grandma avoids spicy food, so maybe not Mexican.'),
      L('sun_church', 'Your grandparents go to church every Sunday until 1 pm.', ['church', 'sunday'], (p) => p.when === 'sun_lunch', { when: 'sat_lunch' }, 'They have church on Sundays until 1.'),
      L('no_apps', 'Your grandparents do not use phone apps and get nervous with strangers driving.', ['app', 'uber', 'lyft', 'stranger', 'rideshare'], (p) => p.ride === 'rideshare', { ride: 'cousin' }, 'They do not use apps and would be nervous in a rideshare.'),
      L('trip_budget', 'A trip voucher is too expensive for you to chip in for.', ['expensive', 'afford', 'trip', 'voucher', 'budget', 'money'], (p) => p.gift === 'trip', { gift: 'album' }, 'A trip voucher is more than I can chip in.')
    ],
    info: [
      { kw: ['cost', 'price', '$', 'voucher', 'album'], text: 'For this game: a photo album is about $40 total, flowers about $50, and a trip voucher about $300.' }
    ]
  },

  cleanup: {
    id: 'cleanup', title: 'Run a beach cleanup for your club', short: 'Beach cleanup',
    prompt: 'Your club is running a volunteer beach cleanup. Agree on the plan.',
    fields: [
      { id: 'where', name: 'Beach', options: [o('pb', 'Pacific Beach', ['pacific beach', 'pb'], { fare: 18, place: 'a taco shop in Pacific Beach' }), o('ob', 'Ocean Beach', ['ocean beach', 'ob'], { fare: 22, place: 'a cafe in Ocean Beach' }), o('shores', 'La Jolla Shores', ['shores', 'la jolla'], { fare: 12, place: 'a grill near La Jolla Shores' })] },
      { id: 'when', name: 'When', options: [o('sat_am', 'Saturday morning', ['saturday morning', 'saturday']), o('sun_am', 'Sunday morning', ['sunday morning', 'sunday']), o('fri_pm', 'Friday afternoon', ['friday'])] },
      TRAVEL,
      { id: 'supplies', name: 'Supplies', options: [o('buy', 'Buy gloves and bags', ['buy', 'purchase', 'amazon']), o('borrow', 'Borrow the city\'s free kit', ['borrow', 'city kit', 'free kit']), o('bring', 'Everyone brings their own', ['bring our own', 'bring your own', 'bring my own'])] }
    ],
    limits: [
      L('club_funds', 'You are the treasurer, and the club has no money left this quarter.', ['treasurer', 'funds', 'money', 'budget', 'buy'], (p) => p.supplies === 'buy', { supplies: 'borrow' }, 'Treasurer here: we have no money left, so we cannot buy supplies.'),
      L('kit_saturday', 'You checked: the city only lends its free kit for Saturday events.', ['kit', 'lend', 'only saturday'], (p) => p.supplies === 'borrow' && p.when !== 'sat_am', { when: 'sat_am' }, 'The city only lends its free kit for Saturday events.'),
      L('friday_class', 'Most members have a lab on Friday afternoon.', ['friday', 'lab'], (p) => p.when === 'fri_pm', { when: 'sat_am' }, 'Most of us have a lab on Friday afternoon.'),
      L('no_car', 'You do not have a car, and neither do most new members.', ['no car', 'car', 'drive', 'carpool'], (p) => p.travel === 'carpool', { travel: 'transit' }, 'Most of us do not have cars, so carpooling would not work.'),
      L('ob_event', 'You saw that Ocean Beach has a big festival this Saturday.', ['festival', 'ocean beach', 'crowded'], (p) => p.where === 'ob' && p.when === 'sat_am', { where: 'pb' }, 'Ocean Beach has a festival on Saturday, so it will be packed.')
    ],
    info: [
      { kw: ['bus', 'trolley', 'transit', 'get to'], text: 'For this game: buses reach all three beaches; La Jolla Shores is closest to campus.' },
      { kw: ['kit', 'gloves', 'bags', 'supplies'], text: 'For this game: the city lends free cleanup kits with gloves and bags; buying them costs about $40.' }
    ]
  },

  moving: {
    id: 'moving', title: 'Help a friend move apartments', short: 'Moving day',
    prompt: 'Your friend Alex is moving to a new apartment. Agree on the moving day plan.',
    fields: [
      { id: 'day', name: 'Day', options: [o('sat', 'Saturday', ['saturday']), o('sun', 'Sunday', ['sunday']), o('fri', 'Friday evening', ['friday'])] },
      { id: 'truck', name: 'Truck', options: [o('uhaul', 'Rent a U-Haul', ['u-haul', 'uhaul', 'truck']), o('cars', 'Use our own cars', ['our cars', 'own cars', 'my car']), o('movers', 'Hire movers', ['movers', 'hire'])] },
      { id: 'start', name: 'Start time', options: [o('t8', '8 am', ['8 am', '8am', 'early']), o('t11', '11 am', ['11 am', '11am']), o('t2', '2 pm', ['2 pm', '2pm', 'afternoon'])] },
      { id: 'thanks', name: 'Thank you', options: [o('pizza', 'Alex buys pizza', ['pizza']), o('dinner', 'Dinner out later', ['dinner']), o('none', 'Nothing needed', ['nothing', 'no need'])] }
    ],
    limits: [
      L('no_license', 'You do not have a driver\'s license.', ['license', 'cannot drive', 'drive'], (p) => p.truck === 'cars', { truck: 'uhaul' }, 'I cannot drive, so our own cars would not include me.'),
      L('movers_cost', 'Alex told you movers are way over their budget.', ['movers', 'budget', 'expensive', 'afford'], (p) => p.truck === 'movers', { truck: 'uhaul' }, 'Alex said movers are way over their budget.'),
      L('sun_work', 'You work Sunday mornings until noon.', ['sunday', 'work', 'shift'], (p) => p.day === 'sun' && p.start !== 't2', { day: 'sat' }, 'I work Sunday mornings until noon.'),
      L('elevator', 'You checked: the building only allows moves between 10 am and 4 pm.', ['10 am', '4 pm', 'building', 'elevator', 'rules'], (p) => p.start === 't8' || p.day === 'fri', { start: 't11' }, 'The building only allows moves between 10 and 4.'),
      L('gluten', 'You cannot eat pizza.', ['pizza', 'gluten', 'cannot eat'], (p) => p.thanks === 'pizza', { thanks: 'dinner' }, 'I cannot eat pizza, so maybe dinner later instead?')
    ],
    info: [
      { kw: ['u-haul', 'uhaul', 'truck', 'cost', '$'], text: 'For this game: a U-Haul is about $40 plus mileage, movers about $400.' }
    ]
  },

  hackathon: {
    id: 'hackathon', title: 'Plan your hackathon team', short: 'Hackathon team',
    prompt: 'Your team entered a 24 hour hackathon next weekend. Agree on how you will work.',
    fields: [
      { id: 'idea', name: 'Project', options: [o('app', 'A mobile app', ['mobile app', 'app', 'ios', 'android']), o('web', 'A website', ['website', 'web app', 'web']), o('hardware', 'A hardware gadget', ['hardware', 'arduino', 'gadget'])] },
      { id: 'stack', name: 'Language', options: [o('python', 'Python', ['python', 'flask']), o('js', 'JavaScript', ['javascript', 'react', 'node', 'js']), o('swift', 'Swift', ['swift'])] },
      { id: 'sleep', name: 'Sleep plan', options: [o('allnight', 'Stay up all night', ['all night', 'no sleep', 'all-nighter']), o('shifts', 'Sleep in shifts', ['shifts', 'take turns']), o('home', 'Everyone sleeps at home', ['sleep at home', 'go home'])] },
      { id: 'roles', name: 'Roles', options: [o('fixed', 'Fixed roles', ['fixed roles', 'frontend', 'backend', 'designer']), o('pair', 'Pair up', ['pair', 'pairs']), o('free', 'Everyone does everything', ['everyone does', 'no roles'])] }
    ],
    limits: [
      L('no_mac', 'You do not have a Mac, so you cannot write Swift.', ['mac', 'swift', 'windows'], (p) => p.stack === 'swift' || p.idea === 'app' && p.stack === 'swift', { stack: 'js' }, 'I do not have a Mac, so Swift is out for me.'),
      L('need_sleep', 'You have a work shift the morning after the hackathon, so you need some sleep.', ['sleep', 'all night', 'tired', 'shift'], (p) => p.sleep === 'allnight', { sleep: 'shifts' }, 'I really need some sleep, so an all-nighter will not work for me.'),
      L('far_home', 'You live an hour away, so going home to sleep is not realistic.', ['hour away', 'far', 'commute', 'go home'], (p) => p.sleep === 'home', { sleep: 'shifts' }, 'I live an hour away, so going home to sleep does not work.'),
      L('no_parts', 'You checked: no hardware parts can arrive before the event.', ['parts', 'hardware', 'arrive', 'shipping'], (p) => p.idea === 'hardware', { idea: 'web' }, 'Hardware parts cannot arrive in time.'),
      L('new_python', 'You only know JavaScript, and you want a clear role.', ['javascript', 'only know', 'clear role', 'role'], (p) => p.stack === 'python' || p.roles === 'free', { stack: 'js', roles: 'fixed' }, 'I only know JavaScript, and I would like a clear role.')
    ],
    info: [
      { kw: ['rules', 'prize', 'judge'], text: 'For this game: judges score the demo, and teams can use any language.' }
    ]
  },

  concert: {
    id: 'concert', title: 'Go to a concert together', short: 'Concert night',
    prompt: 'Your friends want to see a concert this month. Agree on the plan.',
    fields: [
      { id: 'show', name: 'Show', options: [o('pop', 'Pop show at Pechanga Arena', ['pop', 'pechanga', 'arena'], { fare: 28, place: 'a restaurant near Pechanga Arena' }), o('indie', 'Indie band at the Observatory North Park', ['indie', 'observatory', 'north park'], { fare: 22, place: 'a pizza place in North Park' }), o('jazz', 'Jazz at the Rady Shell', ['jazz', 'rady', 'shell'], { fare: 20, place: 'a restaurant near the Rady Shell' })] },
      { id: 'tickets', name: 'Tickets', options: [o('ga', 'General admission', ['general admission', 'ga', 'standing']), o('seats', 'Reserved seats', ['seats', 'reserved', 'sit'])] },
      TRAVEL,
      BUDGET_LOW_MID_HIGH(['Under $40', ['under 40', 'under $40', 'cheap']], ['$40 to $80', ['$60', '40 to 80']], ['Over $80', ['over 80', 'over $80', '$100']], [35, 60, 100])
    ],
    limits: [
      L('budget40', 'You can spend at most $40 on the night.', ['$40', '40 dollars', 'budget', 'afford', 'money', 'expensive'], (p) => p.budget !== 'low', { budget: 'low' }, 'I can spend about 40 dollars at most.', { maxPerPerson: 40 }),
      L('standing', 'You cannot stand for hours because of a knee brace.', ['knee', 'stand', 'standing', 'brace'], (p) => p.tickets === 'ga', { tickets: 'seats' }, 'I have a knee brace, so I cannot stand for hours. Seats would help.'),
      L('pop_sold', 'You checked: the pop show is sold out except for $150 resale tickets.', ['sold out', 'resale', 'pop'], (p) => p.show === 'pop', { show: 'jazz' }, 'The pop show is sold out unless we pay 150 dollars for resale.'),
      L('no_car', 'You do not drive at night.', ['drive at night', 'night driving', 'no car', 'car'], (p) => p.travel === 'carpool', { travel: 'transit' }, 'I do not drive at night, so carpooling is hard.'),
      L('indie_ga', 'You checked: the Observatory is general admission only.', ['observatory', 'general admission only', 'no seats'], (p) => p.show === 'indie' && p.tickets === 'seats', { show: 'jazz' }, 'The Observatory has no seats, only general admission.')
    ],
    info: [
      { kw: ['price', 'cost', '$', 'ticket'], text: 'For this game: Rady Shell lawn seats are about $35, Observatory tickets about $30, and pop show tickets about $90.' },
      { kw: ['trolley', 'bus', 'transit', 'get to'], text: 'For this game: the trolley reaches the Rady Shell and Pechanga Arena; North Park is a bus ride.' }
    ]
  },

  housing: {
    id: 'housing', title: 'Choose an apartment for next year', short: 'Next year\'s apartment',
    prompt: 'Your group will live together next year. Agree on what kind of apartment to look for.',
    fields: [
      { id: 'area', name: 'Area', options: [o('utc', 'University City (UTC)', ['utc', 'university city']), o('pb', 'Pacific Beach', ['pacific beach', 'pb', 'beach']), o('clairemont', 'Clairemont', ['clairemont'])] },
      { id: 'rooms', name: 'Rooms', options: [o('shared', 'Shared bedrooms', ['shared room', 'share a room', 'shared bedrooms', 'double']), o('singles', 'Everyone has a single', ['single', 'own room'])] },
      { id: 'rent', name: 'Rent per person', options: [o('r900', 'Under $900', ['under 900', 'under $900', 'cheap']), o('r1300', '$900 to $1,300', ['$1000', '$1,000', '$1200', '900 to 1300']), o('r1600', 'Over $1,300', ['over 1300', '$1500', '$1,500'])] },
      { id: 'lease', name: 'Lease starts', options: [o('june', 'June', ['june']), o('sept', 'September', ['september', 'sept', 'fall'])] }
    ],
    limits: [
      L('rent_cap', 'You can pay at most $900 a month.', ['$900', '900', 'rent', 'afford', 'budget', 'money'], (p) => p.rent !== 'r900', { rent: 'r900' }, 'I can only do about 900 a month.'),
      L('light_sleeper', 'You are a very light sleeper and need your own room.', ['light sleeper', 'own room', 'single', 'sleep'], (p) => p.rooms === 'shared', { rooms: 'singles' }, 'I am a light sleeper, so I need my own room.'),
      L('summer_home', 'You go home for the summer and cannot pay June to August rent.', ['summer', 'go home', 'june'], (p) => p.lease === 'june', { lease: 'sept' }, 'I go home in the summer, so a June lease means three months of rent for nothing.'),
      L('no_car', 'You do not have a car and need a direct bus to campus.', ['no car', 'bus', 'commute', 'car'], (p) => p.area === 'pb', { area: 'clairemont' }, 'I do not have a car, and Pacific Beach has no direct bus to campus.'),
      L('utc_prices', 'You checked: singles in UTC start at $1,200 a person.', ['utc', 'expensive', '$1,200', '1200'], (p) => p.area === 'utc' && p.rooms === 'singles' && p.rent === 'r900', { area: 'clairemont' }, 'Singles in UTC start at 1,200 a person.')
    ],
    info: [
      { kw: ['rent', 'price', 'cost', '$'], text: 'For this game: singles are about $850 in Clairemont, $1,200 in UTC, and $1,400 in Pacific Beach.' },
      { kw: ['bus', 'commute', 'campus', 'get to'], text: 'For this game: UTC and Clairemont have direct buses to campus; Pacific Beach needs a transfer.' }
    ]
  },

  volunteer: {
    id: 'volunteer', title: 'Pick a volunteer day for your group', short: 'Volunteer day',
    prompt: 'Your group wants to volunteer together once this quarter. Agree on the plan.',
    fields: [
      { id: 'where', name: 'Where', options: [o('foodbank', 'San Diego Food Bank', ['food bank', 'food'], { fare: 24, place: 'a cafe near the Food Bank' }), o('shelter', 'Animal shelter', ['animal', 'shelter', 'dogs'], { fare: 20, place: 'a cafe nearby' }), o('tutoring', 'Tutoring kids at a library', ['tutor', 'tutoring', 'kids', 'library'], { fare: 12, place: 'a cafe near the library' })] },
      { id: 'when', name: 'When', options: [o('sat', 'Saturday morning', ['saturday']), o('sun', 'Sunday afternoon', ['sunday']), o('wed', 'Wednesday afternoon', ['wednesday'])] },
      TRAVEL,
      { id: 'after', name: 'Afterward', options: [o('lunch', 'Lunch together', ['lunch']), o('coffee', 'Coffee', ['coffee', 'boba']), o('none', 'Head home', ['head home', 'go home', 'nothing after'])] }
    ],
    limits: [
      L('allergy', 'You are very allergic to cats.', ['allerg', 'cats', 'sneez'], (p) => p.where === 'shelter', { where: 'tutoring' }, 'I am really allergic to cats, so the shelter is hard for me.'),
      L('wed_class', 'You have class every Wednesday afternoon.', ['wednesday', 'class'], (p) => p.when === 'wed', { when: 'sat' }, 'I have class Wednesday afternoons.'),
      L('foodbank_full', 'You checked: the food bank is full on Saturdays this month.', ['full', 'food bank', 'booked', 'saturday'], (p) => p.where === 'foodbank' && p.when === 'sat', { where: 'tutoring' }, 'The food bank is full on Saturdays this month.'),
      L('carsick', 'You get carsick, so you can only take the bus or trolley.', ['carsick', 'car sick', 'motion sick', 'only the bus'], (p) => p.travel !== 'transit', { travel: 'transit' }, 'I get carsick, so I would take the bus.'),
      L('broke', 'You cannot spend money eating out this week.', ['money', 'afford', 'spend', 'broke', 'expensive'], (p) => p.after === 'lunch', { after: 'coffee' }, 'I cannot really spend money on lunch this week. Coffee or nothing is fine.')
    ],
    info: [
      { kw: ['library', 'tutor', 'background'], text: 'For this game: library tutoring needs a 10 minute online sign-up, no background check.' },
      { kw: ['bus', 'trolley', 'transit', 'get to'], text: 'For this game: all three places are reachable by bus.' }
    ]
  }
};
