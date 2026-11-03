// The North Lot scenario. All facts are fictional and written for the game.
export const SCENARIO = {
  id: 'north-lot',
  title: 'The North Lot',
  place: 'North lot (fictional)',
  question: 'How should the underused north lot be used?',
  step: 10,
  total: 100,
  maxUse: 40, // rule enforced by the AI Administrator
  uses: [
    { id: 'study', name: 'Study space', color: '#6250d6', ink: '#ffffff' },
    { id: 'clubs', name: 'Club hub', color: '#e87ba4', ink: '#0b0b0b' },
    { id: 'green', name: 'Green space', color: '#008300', ink: '#ffffff' },
    { id: 'parking', name: 'Parking', color: '#7a7974', ink: '#ffffff' }
  ],
  start: { study: 20, clubs: 10, green: 20, parking: 50 },
  // Roles are dealt in this order: a 3 seat table uses the first three.
  roles: [
    {
      id: 'student', name: 'Student', initial: 'S', color: '#2a78d6',
      goal: 'Turn at least 30% of the lot into study space.',
      check: (p) => p.study >= 30,
      factId: 'library_full',
      fact: 'The library is full from 2 to 6 pm in weeks 8 to 10.',
      aiLine: 'Students need somewhere to study. Could we get study space up to 30%?',
      target: 'study'
    },
    {
      id: 'faculty', name: 'Faculty member', initial: 'F', color: '#eb6834',
      goal: 'Keep at least 20% of the lot as parking.',
      check: (p) => p.parking >= 20,
      factId: 'shuttle_stops',
      fact: 'Evening labs end at 9 pm, but the campus shuttle stops at 7 pm.',
      aiLine: 'People in evening labs still need to park. I can accept less parking, but not below 20%.',
      target: 'parking'
    },
    {
      id: 'club', name: 'Club leader', initial: 'C', color: '#eda100',
      goal: 'Get at least 20% of the lot for a club hub.',
      check: (p) => p.clubs >= 20,
      factId: 'clubs_no_room',
      fact: 'Twelve student clubs have no weekday meeting room.',
      aiLine: 'The club hub does not fit in less than 20%. Can we take 10 from the largest use?',
      target: 'clubs'
    },
    {
      id: 'planner', name: 'Facilities planner', initial: 'P', color: '#1baf7a',
      goal: 'Keep at least 20% of the lot as green space.',
      check: (p) => p.green >= 20,
      factId: 'shade_west',
      fact: 'Trees on the west side shade the lot until about 3 pm.',
      aiLine: 'We should keep at least 20% green space. The west side is shaded and good for it.',
      target: 'green'
    },
    {
      id: 'commuter', name: 'Commuter student', initial: 'M', color: '#8f5bd6',
      goal: 'Keep at least 30% of the lot as parking.',
      check: (p) => p.parking >= 30,
      factId: 'structure_full',
      fact: 'The nearest parking structure is full by 9:30 am on weekdays.',
      aiLine: 'Commuters have nowhere else to park in the morning. Parking should stay at 30% or more.',
      target: 'parking'
    }
  ],
  layers: [
    { id: 'traffic', name: 'Foot traffic', fact: 'Busiest along the north edge between classes. Quiet after 6 pm.' },
    { id: 'shade', name: 'Shade', fact: 'The west side of the lot is in shade until about 3 pm.' },
    { id: 'parking', name: 'Parking use', fact: 'About 4 in 10 stalls are used at the busiest hour. Many stay empty in the morning.' },
    { id: 'noise', name: 'Noise', fact: 'Loudest near the dining hall at lunch. Calmer on the north side of the lot.' }
  ]
};

export const roleById = (id) => SCENARIO.roles.find((r) => r.id === id);
export const useName = (id) => SCENARIO.uses.find((u) => u.id === id)?.name || id;
export const totalOf = (p) => SCENARIO.uses.reduce((s, u) => s + p[u.id], 0);
export const ruleOk = (p) => SCENARIO.uses.every((u) => p[u.id] <= SCENARIO.maxUse);
export const ruleBreaks = (p) => SCENARIO.uses.filter((u) => p[u.id] > SCENARIO.maxUse);
