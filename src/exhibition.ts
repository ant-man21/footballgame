// PLAY NOW at high school or college level: two random schools, their colours,
// their stadium and pregame show, rosters at that level of play. You call the
// plays and play the MIKE, as in any exhibition. (Pro stays the classic
// blue-vs-red game in Game.newGame.)
import type { CareerGameSetup } from './game';
import { Match } from './match';
import { makeRoster } from './ratings';
import { kitsFor } from './sprites';
import { COLLEGES } from './career/recruiting';
import { COLLEGE_TIER } from './career/college';
import { HS_TIER } from './career/player';
import { STATES, makeSchools } from './career/hsnames';
import { Rng } from './career/rng';

export type Level = 'hs' | 'college' | 'pro';

interface School { name: string; mascot: string; abbr: string; colors: [string, string]; strength: number; tag?: string }

const FBS = COLLEGES.filter((c) => c.division === 'FBS');
const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

function colleges(): [School, School] {
  const a = pick(FBS);
  let b = pick(FBS);
  while (b.id === a.id) b = pick(FBS);
  const s = (c: typeof a): School => ({
    name: c.name, mascot: c.mascot, abbr: c.abbr, colors: c.colors,
    strength: (c.prestige - 55) / 6, tag: c.conference,
  });
  return [s(a), s(b)];
}

function highSchools(): [School, School] {
  const rng = new Rng(Math.floor(Math.random() * 2 ** 31));
  const state = pick(STATES);
  const [a, b] = makeSchools(state, 2, rng);
  const s = (x: typeof a): School => ({ ...x, strength: 0, tag: state.name });
  return [s(a), s(b)];
}

/** A random matchup at that level. oppStrength: the difficulty's edge for the other team (rating points). */
export function exhibitionSetup(level: 'hs' | 'college', quarterSecs: number, oppStrength: number, onDone: () => void): CareerGameSetup {
  const college = level === 'college';
  const [you, cpu] = college ? colleges() : highSchools();
  const tier = college ? COLLEGE_TIER : HS_TIER;
  const home = Math.random() < 0.5;
  const k = home ? kitsFor(you.colors, cpu.colors) : kitsFor(cpu.colors, you.colors);
  const h = home ? you : cpu, a = home ? cpu : you;
  const match = new Match('you', quarterSecs);
  match.names = { you: you.abbr, cpu: cpu.abbr };
  return {
    exhibition: true,
    match,
    you: makeRoster(you.name, you.strength, tier),
    opp: makeRoster(cpu.name, cpu.strength + oppStrength, tier),
    units: { you: { off: you.strength, def: you.strength }, cpu: { off: cpu.strength, def: cpu.strength } },
    simDefense: false, coachCalls: false, endAtHalf: false,
    label: `${you.abbr} VS ${cpu.abbr}`,
    kits: home ? { you: k.home, cpu: k.away } : { you: k.away, cpu: k.home },
    crowd: { home: h.colors, away: a.colors, homeName: h.mascot, big: college, abbr: h.abbr },
    schools: { you: { name: you.name, mascot: you.mascot }, cpu: { name: cpu.name, mascot: cpu.mascot } },
    card: { story: college ? 'COLLEGE EXHIBITION' : 'HIGH SCHOOL EXHIBITION', weather: college ? 'SATURDAY' : 'FRIDAY NIGHT' },
    intro: {
      home: home ? 'you' : 'cpu', top: college ? 'COLLEGE EXHIBITION' : 'FRIDAY NIGHT EXHIBITION', big: false, college,
      names: { you: you.name, cpu: cpu.name }, mascots: { you: you.mascot, cpu: cpu.mascot }, abbrs: { you: you.abbr, cpu: cpu.abbr },
      colors: { you: you.colors, cpu: cpu.colors }, tags: { you: you.tag ?? '', cpu: cpu.tag ?? '' },
    },
    onDone,
  };
}
