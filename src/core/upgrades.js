// "Unlearnings" — the between-depth choices. Kept in the core so simulation
// bots and the shipped game draw from exactly the same upgrade table.
export const UPGRADES = {
  nerve:      { id: 'nerve',      name: 'Wider Nerve',    blurb: '+2 maximum Nerve, and start each depth with 2.' },
  breath:     { id: 'breath',     name: 'Longer Breath',  blurb: '+6 Breath at the start of every depth.' },
  composure:  { id: 'composure',  name: 'Deep Composure', blurb: '+1 maximum Composure, and recover 1 now.' },
  hush:       { id: 'hush',       name: 'Hush Sense',     blurb: '+2 Hush tiles per depth — ground that teaches nothing.' },
  cheapdecoy: { id: 'cheapdecoy', name: 'Easy Lie',       blurb: 'A Decoy costs 1 Nerve instead of 2.' },
  stun:       { id: 'stun',       name: 'Unnerving',      blurb: '+1 turn of stun from every startle.' },
  secondwind: { id: 'secondwind', name: 'Second Wind',    blurb: 'The first hit of each depth refunds 6 Breath.' },
  motewind:   { id: 'motewind',   name: 'Mote Wind',      blurb: 'Each mote grants +2 extra Breath.' },
};

export const UPGRADE_IDS = Object.keys(UPGRADES);

export function rollChoices(rng, n = 3, owned = []) {
  const pool = UPGRADE_IDS.filter(id => !owned.includes(id));
  rng.shuffle(pool);
  // If everything is owned, allow stacking so a choice is always available.
  const picks = pool.slice(0, n);
  while (picks.length < n) picks.push(rng.pick(UPGRADE_IDS));
  return picks;
}

export function has(run, id) { return run.upgrades.includes(id); }
export function times(run, id) { return run.upgrades.filter(u => u === id).length; }
