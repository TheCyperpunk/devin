// Plays Pralayam with bots only, in milliseconds, to tune the rules and the star thresholds (GAME-PLAN G1).
// Usage: npm run sim                       one game on the fixed Thuruthu calls, round-by-round log
//        npm run sim -- --bots 4 --seed 7   more boats / another generator seed
//        npm run sim -- --games 200         random nights (generator on): score distribution + suggested starBase
import { GAME, Ward, addBots, newGame, parseScenario, resolveRound, startGame, thuruthu, type GameEvent, type GameState, type Scenario } from '../shared/src/game/index.js';

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : def;
};
const bots = arg('bots', 3);
const seed = arg('seed', 7);
const games = arg('games', 1);
const random = games > 1 || process.argv.includes('--random');

const base = parseScenario(thuruthu);
const scenario: Scenario = random ? { ...base, calls: [], generator: { seed, perRound: [1, 2] } } : base;
const ward = new Ward(scenario);

function play(seedFor: number): GameState {
  let s = newGame(scenario, { id: `sim-${seedFor}`, now: 0, bots: false, seed: seedFor });
  s = addBots(s, scenario, bots);
  s = startGame(s, scenario, 0);
  let t = 0;
  while (s.phase !== 'ended') {
    t += s.roundSeconds * 1000;
    s = resolveRound(s, ward, t).state;
  }
  return s;
}

const count = (events: GameEvent[], type: GameEvent['type']) => events.filter((e) => e.type === type).reduce((n, e) => n + (e.count ?? 1), 0);
const totals = (s: GameState) => {
  const all = s.history.flatMap((h) => h.events);
  const people = s.calls.reduce((n, c) => n + c.peopleCount, 0);
  return { people, saved: count(all, 'saved') + count(all, 'saved_late'), lost: count(all, 'lost'), invalid: count(all, 'invalid'), kits: count(all, 'kit_matched') };
};

if (!random) {
  const t0 = performance.now();
  const s = play(seed);
  const ms = (performance.now() - t0).toFixed(1);
  console.log(`Thuruthu · ${bots} bots · ${s.history.length} rounds in ${ms} ms\n`);
  for (const h of s.history) {
    const e = h.events;
    const line = [
      `R${String(h.round).padStart(2)}`,
      `water ${h.waterLevel}`,
      `calls +${e.filter((x) => x.type === 'call_opened').length}`,
      `rescued ${count(e, 'rescued')}`,
      `saved ${count(e, 'saved')}`,
      `lost ${count(e, 'lost')}`,
      `kits ${count(e, 'kit_matched')}/${count(e, 'kit_wasted')}`,
      `invalid ${count(e, 'invalid')}`,
      `score ${String(h.scoreAfter).padStart(4)}`,
    ];
    console.log(line.join('  '));
  }
  const t = totals(s);
  console.log(`\nFinal: score ${s.score}, ${'★'.repeat(s.stars)}${'☆'.repeat(3 - s.stars)} (base ${s.starBase}), saved ${t.saved} of ${t.people}, lost ${t.lost}, kits ${t.kits}, invalid orders ${t.invalid}`);
  console.log('Crews: ' + s.boats.map((b) => `${b.name} ${b.saved}`).join(' · '));
} else {
  const scores: number[] = [];
  let lostSum = 0;
  let savedSum = 0;
  let peopleSum = 0;
  const t0 = performance.now();
  for (let i = 0; i < games; i++) {
    const s = play(seed + i);
    const t = totals(s);
    scores.push(s.score);
    lostSum += t.lost;
    savedSum += t.saved;
    peopleSum += t.people;
  }
  const ms = (performance.now() - t0).toFixed(0);
  scores.sort((a, b) => a - b);
  const q = (p: number) => scores[Math.min(scores.length - 1, Math.floor(p * scores.length))];
  console.log(`${games} random nights · ${bots} bots · ${ms} ms total`);
  console.log(`score min ${q(0)}  p25 ${q(0.25)}  median ${q(0.5)}  p75 ${q(0.75)}  max ${scores[scores.length - 1]}`);
  console.log(`saved ${((savedSum / peopleSum) * 100).toFixed(0)}% of ${peopleSum} people, lost ${lostSum}`);
  console.log(`suggested starBase = median bot score = ${q(0.5)}  (GAME.defaultStarBase is ${GAME.defaultStarBase}; 2★ at ×${GAME.stars.two}, 3★ at ×${GAME.stars.three})`);
}
