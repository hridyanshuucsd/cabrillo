// Group planning tasks. Each task has a few plan fields with fixed options, and private limit cards.
// Limits are dealt one per seat. At least one plan respects every limit, so the group can always succeed.
// Places are real San Diego names, but all limits, prices, and times are invented for the game.

import { SCENARIOS, TRAVEL } from './scenarios.js';

const o = (id, name, kw) => ({ id, name, kw });

export const TASKS = {
  outing: {
    id: 'outing',
    title: 'Plan a weekend outing',
    short: 'Weekend outing',
    prompt: 'Your group has a free weekend. Agree on one outing that works for everyone.',
    fields: [
      { id: 'where', name: 'Where', options: [o('cove', 'La Jolla Cove', ['cove', 'la jolla', 'beach', 'seals']), o('balboa', 'Balboa Park', ['balboa', 'museum']), o('oldtown', 'Old Town', ['old town', 'oldtown', 'taco']), o('torrey', 'Torrey Pines hike', ['torrey', 'hike', 'hiking', 'trail'])] },
      { id: 'when', name: 'When', options: [o('sat_am', 'Saturday morning', ['saturday morning', 'sat morning', 'sat am']), o('sat_pm', 'Saturday afternoon', ['saturday afternoon', 'sat afternoon', 'sat pm', 'saturday evening']), o('sun_am', 'Sunday morning', ['sunday morning', 'sun morning', 'sun am']), o('sun_pm', 'Sunday afternoon', ['sunday afternoon', 'sun afternoon', 'sun pm', 'sunday evening'])] },
      TRAVEL,
      { id: 'budget', name: 'Budget per person', options: [o('low', 'Under $15', ['under 15', 'under $15', 'cheap', '$10', '10 dollars', '15 dollars', '15 bucks', 'at most 15', 'at most $15', 'max 15', 'max $15', '$15 max']), o('mid', '$15 to $30', ['$20', '$25', '20 dollars', '25 dollars', '15 to 30', '$15 to $30', '15-30']), o('high', 'Over $30', ['$40', '$50', 'over 30', 'over $30'])] }
    ],
    limits: [
      { id: 'works_sat', text: 'You work every Saturday until 5 pm.', re: /(work|working|shift|job|busy).{0,25}saturday|saturday.{0,25}(work|shift|job|busy|cannot|can't|cant|bad|no good)/i,
        violates: (p) => p.when === 'sat_am' || p.when === 'sat_pm', aiPrefs: { when: 'sun_pm', where: 'oldtown' }, say: 'I should say: I work Saturdays until 5, so Sunday is better for me.' },
      { id: 'budget15', text: 'You can spend at most $15 this weekend.', re: /(\$ ?15|15 dollars|budget|afford|broke|spend|expensive|money|cheap)/i,
        violates: (p) => p.budget === 'mid' || p.budget === 'high', aiPrefs: { budget: 'low', where: 'cove' }, say: 'Money is tight for me this week. I can spend about 15 dollars at most.' },
      { id: 'no_car', text: 'You get very carsick, so you can only take the bus or trolley.', re: /(car ?sick|motion sick|no car|only.{0,20}(bus|trolley)|cannot.{0,10}(ride|car)|can't.{0,10}(ride|car))/i,
        violates: (p) => p.travel === 'carpool' || p.travel === 'rideshare', aiPrefs: { travel: 'transit' }, say: 'Small thing: I get carsick, so the trolley or the bus works best for me.' },
      { id: 'no_hike', text: 'You hurt your ankle last week and cannot hike.', re: /(ankle|injur|hurt my|cannot hike|can't hike|cant hike|no hik|not.{0,10}hik)/i,
        violates: (p) => p.where === 'torrey', aiPrefs: { where: 'balboa' }, say: 'I hurt my ankle last week, so a hike is out for me.' },
      { id: 'sun_am_busy', text: 'You have a team practice every Sunday morning.', re: /(practice|game|training|busy|cannot|can't|cant).{0,25}sunday morning|sunday morning.{0,25}(practice|busy|cannot|can't|cant|no good)/i,
        violates: (p) => p.when === 'sun_am', aiPrefs: { when: 'sun_pm' }, say: 'I have practice on Sunday mornings, so not then.' }
    ],
    info: [
      { kw: ['trolley', 'bus', 'transit', 'get to', 'how far', 'far'], text: 'For this game: Old Town and Balboa Park are easy by trolley or bus, La Jolla Cove is a short bus ride, and Torrey Pines is easiest by car.' },
      { kw: ['cost', 'price', 'money', 'expensive', 'cheap', '$', 'budget'], text: 'For this game: the Cove and a Torrey Pines hike are free, Balboa Park is free unless you enter a museum, and Old Town food is about 10 to 20 dollars.' },
      { kw: ['weather', 'hot', 'sun', 'shade'], text: 'For this game: mornings are cooler, and afternoons at the beach are the warmest.' }
    ]
  },
  project: {
    id: 'project',
    title: 'Split a class group project',
    short: 'Group project',
    prompt: 'Your group has a four-part class project due next Friday. Agree on how you will work.',
    fields: [
      { id: 'meet', name: 'Meeting time', options: [o('mon_eve', 'Monday evening', ['monday']), o('wed_pm', 'Wednesday afternoon', ['wednesday']), o('thu_eve', 'Thursday evening', ['thursday']), o('online', 'Online only, no meeting', ['online', 'zoom', 'async', 'no meeting'])] },
      { id: 'tool', name: 'Where we write', options: [o('gdocs', 'Google Docs', ['google doc', 'gdoc', 'docs']), o('notion', 'Notion', ['notion']), o('overleaf', 'Overleaf', ['overleaf', 'latex'])] },
      { id: 'draft', name: 'Draft due', options: [o('tue', 'Tuesday', ['draft tuesday', 'due tuesday', 'by tuesday']), o('wed', 'Wednesday', ['draft wednesday', 'due wednesday', 'by wednesday']), o('thu', 'Thursday', ['draft thursday', 'due thursday', 'by thursday'])] },
      { id: 'split', name: 'How we split it', options: [o('section', 'One section each', ['section', 'part each', 'one part']), o('role', 'By role (research, writing, editing, slides)', ['role', 'slides', 'editing', 'research']), o('all', 'Everyone works on everything', ['everyone', 'all together', 'together'])] }
    ],
    limits: [
      { id: 'lab_wed', text: 'You have a lab every Wednesday afternoon.', re: /(lab|class|busy|cannot|can't|cant).{0,25}wednesday|wednesday.{0,25}(lab|class|busy|cannot|can't|cant)/i,
        violates: (p) => p.meet === 'wed_pm', aiPrefs: { meet: 'mon_eve' }, say: 'I have a lab on Wednesday afternoons, so I cannot meet then.' },
      { id: 'away_thu', text: 'You are away all day Thursday for an interview.', re: /(interview|away|travel|busy|cannot|can't|cant).{0,25}thursday|thursday.{0,25}(interview|away|busy|cannot|can't|cant)/i,
        violates: (p) => p.meet === 'thu_eve' || p.draft === 'thu', aiPrefs: { draft: 'wed' }, say: 'I am away on Thursday for an interview, so a Thursday meeting or deadline will not work for me.' },
      { id: 'phone_only', text: 'Your laptop is broken this week, so you can only work on your phone. Overleaf is very hard on a phone.', re: /(laptop|phone|overleaf.{0,20}(hard|bad|cannot|can't))/i,
        violates: (p) => p.tool === 'overleaf', aiPrefs: { tool: 'gdocs' }, say: 'My laptop broke, so I am on my phone this week. Google Docs works on a phone; Overleaf really does not.' },
      { id: 'midterms_tue', text: 'You have two midterms on Tuesday.', re: /(midterm|exam|test).{0,25}tuesday|tuesday.{0,25}(midterm|exam|test)/i,
        violates: (p) => p.draft === 'tue', aiPrefs: { draft: 'wed' }, say: 'I have two midterms on Tuesday, so a Tuesday draft deadline is too tight for me.' },
      { id: 'slides_person', text: 'You are much stronger at slides than at writing, and you would rather not write a section.', re: /(slides|not.{0,10}writ|bad at writ|rather not write)/i,
        violates: (p) => p.split === 'section' || p.split === 'all', aiPrefs: { split: 'role' }, say: 'Honestly, I am much better at slides than writing. Could we split by role?' }
    ],
    info: [
      { kw: ['overleaf', 'latex', 'phone'], text: 'For this game: Google Docs and Notion work well on phones; Overleaf is hard to use on a phone.' },
      { kw: ['due', 'deadline', 'friday', 'when'], text: 'For this game: the final project is due next Friday at 11:59 pm, and the group needs a draft at least a day before.' }
    ]
  },
  event: {
    id: 'event',
    title: 'Plan a club social',
    short: 'Club social',
    prompt: 'Your club is hosting one social event to welcome new members. Agree on the plan.',
    fields: [
      { id: 'what', name: 'Activity', options: [o('games', 'Board game night', ['board game', 'games']), o('bonfire', 'Beach bonfire', ['bonfire', 'fire pit', 'fire']), o('potluck', 'Potluck', ['potluck', 'food']), o('movie', 'Movie night', ['movie', 'film'])] },
      { id: 'when', name: 'When', options: [o('fri', 'Friday evening', ['friday']), o('sat', 'Saturday afternoon', ['saturday']), o('sun', 'Sunday evening', ['sunday'])] },
      { id: 'where', name: 'Where', options: [o('clubroom', 'Club room on campus', ['club room', 'on campus', 'campus']), o('shores', 'La Jolla Shores', ['shores', 'beach', 'la jolla']), o('apartment', 'A member\'s apartment', ['apartment', 'my place', 'someone\'s place'])] },
      { id: 'budget', name: 'Budget', options: [o('free', 'Free', ['for free', 'free event', 'no cost', 'costs nothing']), o('under50', 'Under $50 total', ['under 50', 'under $50', '$40', '$30']), o('over50', '$50 to $150', ['$100', '$150', 'over 50', 'over $50'])] }
    ],
    limits: [
      { id: 'club_40', text: 'You are the treasurer. The club has only $40 left this quarter.', re: /(treasurer|\$ ?40|40 dollars|budget|money|afford|funds)/i,
        violates: (p) => p.budget === 'over50', aiPrefs: { budget: 'under50' }, say: 'Treasurer update: we only have about 40 dollars left this quarter.' },
      { id: 'no_apartments', text: 'Your landlord does not allow gatherings, and you know several members have the same rule.', re: /(landlord|lease|not allowed|no gatherings|apartment.{0,20}(no|not|cannot|can't))/i,
        violates: (p) => p.where === 'apartment', aiPrefs: { where: 'shores' }, say: 'Apartments might be a problem. My landlord does not allow gatherings, and I think others have the same rule.' },
      { id: 'fire_permit', text: 'You checked: a beach bonfire needs a permit that takes two weeks to get.', re: /(permit|two weeks|2 weeks|bonfire.{0,20}(no|not|cannot|can't))/i,
        violates: (p) => p.what === 'bonfire', aiPrefs: { what: 'potluck' }, say: 'I looked into it: a bonfire needs a permit that takes two weeks.' },
      { id: 'fri_family', text: 'You have a family dinner every Friday night.', re: /(family|dinner|busy|cannot|can't|cant).{0,25}friday|friday.{0,25}(family|dinner|busy|cannot|can't|cant)/i,
        violates: (p) => p.when === 'fri', aiPrefs: { when: 'sat' }, say: 'Friday nights I have a family dinner, so I would miss it.' },
      { id: 'sun_review', text: 'Most new members told you they have an exam review on Sunday evening.', re: /(review|exam|midterm|busy).{0,25}sunday|sunday.{0,25}(review|exam|midterm|busy)/i,
        violates: (p) => p.when === 'sun' || p.where === 'clubroom' && p.when === 'sat', aiPrefs: { when: 'sat', where: 'shores' }, say: 'A lot of the new members have an exam review on Sunday evening. Also, the club room is booked on Saturdays.' }
    ],
    info: [
      { kw: ['club room', 'campus', 'room', 'book'], text: 'For this game: the club room is booked on Saturdays and free on Friday and Sunday evenings.' },
      { kw: ['cost', 'price', 'money', 'budget', '$'], text: 'For this game: board games and movie night are free with what the club owns, and a potluck costs only what people bring.' }
    ]
  }
};

Object.assign(TASKS, SCENARIOS);
TASKS.outing.limits.find((l) => l.id === 'budget15').maxPerPerson = 15;

// 'mixed' is not a task: in a class session it gives every table a different scenario.
export const MIXED = 'mixed';
export const ORDER = Object.keys(TASKS);
export const DEFAULT_TASK = 'outing';
export const taskById = (id) => TASKS[id] || TASKS[DEFAULT_TASK];
export const fieldName = (task, fid) => task.fields.find((f) => f.id === fid)?.name || fid;
export const optionName = (task, fid, oid) => task.fields.find((f) => f.id === fid)?.options.find((x) => x.id === oid)?.name || oid;
export const planComplete = (task, plan) => task.fields.every((f) => !!plan[f.id]);
export const violations = (task, plan, limitIds) => task.limits.filter((l) => limitIds.includes(l.id) && l.violates(plan));
