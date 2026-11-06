// Generated high school identity: towns, mascots and colours. High schools are
// never real (minors, and there are thousands). Towns are built from regional
// word pools, so a Texas league sounds different from a Maine one.
import { Rng } from './rng';

export type Region = 'NE' | 'SOUTH' | 'MIDWEST' | 'PLAINS' | 'WEST' | 'TEXAS';

export interface StateDef { id: string; name: string; region: Region }
export const STATES: StateDef[] = ([
  ['AL', 'ALABAMA', 'SOUTH'], ['AK', 'ALASKA', 'WEST'], ['AZ', 'ARIZONA', 'WEST'], ['AR', 'ARKANSAS', 'SOUTH'],
  ['CA', 'CALIFORNIA', 'WEST'], ['CO', 'COLORADO', 'WEST'], ['CT', 'CONNECTICUT', 'NE'], ['DE', 'DELAWARE', 'NE'],
  ['FL', 'FLORIDA', 'SOUTH'], ['GA', 'GEORGIA', 'SOUTH'], ['HI', 'HAWAII', 'WEST'], ['ID', 'IDAHO', 'WEST'],
  ['IL', 'ILLINOIS', 'MIDWEST'], ['IN', 'INDIANA', 'MIDWEST'], ['IA', 'IOWA', 'PLAINS'], ['KS', 'KANSAS', 'PLAINS'],
  ['KY', 'KENTUCKY', 'SOUTH'], ['LA', 'LOUISIANA', 'SOUTH'], ['ME', 'MAINE', 'NE'], ['MD', 'MARYLAND', 'NE'],
  ['MA', 'MASSACHUSETTS', 'NE'], ['MI', 'MICHIGAN', 'MIDWEST'], ['MN', 'MINNESOTA', 'MIDWEST'], ['MS', 'MISSISSIPPI', 'SOUTH'],
  ['MO', 'MISSOURI', 'MIDWEST'], ['MT', 'MONTANA', 'WEST'], ['NE', 'NEBRASKA', 'PLAINS'], ['NV', 'NEVADA', 'WEST'],
  ['NH', 'NEW HAMPSHIRE', 'NE'], ['NJ', 'NEW JERSEY', 'NE'], ['NM', 'NEW MEXICO', 'WEST'], ['NY', 'NEW YORK', 'NE'],
  ['NC', 'NORTH CAROLINA', 'SOUTH'], ['ND', 'NORTH DAKOTA', 'PLAINS'], ['OH', 'OHIO', 'MIDWEST'], ['OK', 'OKLAHOMA', 'PLAINS'],
  ['OR', 'OREGON', 'WEST'], ['PA', 'PENNSYLVANIA', 'NE'], ['RI', 'RHODE ISLAND', 'NE'], ['SC', 'SOUTH CAROLINA', 'SOUTH'],
  ['SD', 'SOUTH DAKOTA', 'PLAINS'], ['TN', 'TENNESSEE', 'SOUTH'], ['TX', 'TEXAS', 'TEXAS'], ['UT', 'UTAH', 'WEST'],
  ['VT', 'VERMONT', 'NE'], ['VA', 'VIRGINIA', 'SOUTH'], ['WA', 'WASHINGTON', 'WEST'], ['WV', 'WEST VIRGINIA', 'SOUTH'],
  ['WI', 'WISCONSIN', 'MIDWEST'], ['WY', 'WYOMING', 'WEST'],
] as [string, string, Region][]).map(([id, name, region]) => ({ id, name, region }));

// Town = prefix + suffix ("OAK" + "RIDGE"), or a stand-alone town name.
const PREFIX: Record<Region, string[]> = {
  NE: ['NORTH', 'GREEN', 'STONE', 'MAPLE', 'BRIDGE', 'SALEM', 'CHEST', 'FAIR', 'WEST', 'HAVEN', 'MILL', 'ASH'],
  SOUTH: ['MAGNOLIA', 'PINE', 'CEDAR', 'OAK', 'RIVER', 'CLAY', 'COTTON', 'HOLLY', 'PEACH', 'BLUFF', 'SPRING', 'LAUREL'],
  MIDWEST: ['LAKE', 'ELM', 'IRON', 'CORN', 'PRAIRIE', 'BROOK', 'WALNUT', 'GRAND', 'MAPLE', 'FOX', 'OAK', 'HICKORY'],
  PLAINS: ['WHEAT', 'BUFFALO', 'RED', 'BROKEN', 'GRAND', 'COTTON', 'PRAIRIE', 'SALT', 'WILLOW', 'ELK', 'SUN', 'PLATTE'],
  WEST: ['SILVER', 'CANYON', 'EAGLE', 'SIERRA', 'GOLD', 'COPPER', 'PINE', 'RIDGE', 'MESA', 'SUMMIT', 'BEAR', 'CRYSTAL'],
  TEXAS: ['LONE', 'COPPER', 'CEDAR', 'MESQUITE', 'PECAN', 'RED', 'SAN', 'STAR', 'BRAZOS', 'LIBERTY', 'CROSS', 'SANTA'],
};
const SUFFIX: Record<Region, string[]> = {
  NE: ['FIELD', 'FORD', 'TON', 'BURY', 'WOOD', 'PORT', 'BROOK', 'HAM', 'DALE', 'VILLE'],
  SOUTH: ['VILLE', 'WOOD', 'DALE', 'GROVE', 'SPRINGS', 'TON', ' HILL', 'BORO', ' CITY', 'MONT'],
  MIDWEST: ['WOOD', 'VILLE', 'TON', ' RAPIDS', 'FIELD', ' FALLS', 'DALE', ' CREEK', 'VIEW', ' PARK'],
  PLAINS: ['TON', ' BEND', ' CITY', 'WOOD', ' FALLS', 'VILLE', ' FORKS', ' RIDGE', ' PLAINS', 'FIELD'],
  WEST: [' VALLEY', ' CREEK', ' RIDGE', ' PEAK', 'TON', ' SPRINGS', ' MESA', 'VIEW', ' LAKE', ' CITY'],
  TEXAS: [' STAR', ' GROVE', ' CREEK', 'VILLE', ' HILL', ' SPRINGS', 'TON', ' PARK', ' VALLEY', ' CITY'],
};
const DIRECTION = ['NORTH', 'SOUTH', 'EAST', 'WEST', 'CENTRAL'];
const MASCOTS = ['TIGERS', 'EAGLES', 'BULLDOGS', 'PANTHERS', 'WILDCATS', 'LIONS', 'HAWKS', 'RAMS', 'KNIGHTS', 'TROJANS',
  'SPARTANS', 'MUSTANGS', 'COUGARS', 'FALCONS', 'BEARS', 'HORNETS', 'RAIDERS', 'CHARGERS', 'BOBCATS', 'PIRATES', 'VIKINGS',
  'WOLVES', 'COLTS', 'BRONCOS', 'REBELS', 'GATORS', 'OWLS', 'BADGERS', 'HUSKIES', 'COMETS', 'JAGUARS', 'SAINTS', 'STORM',
  'BLUE DEVILS', 'RED RAIDERS', 'GOLDEN BEARS', 'WARRIORS', 'PATRIOTS', 'GRIZZLIES', 'MAVERICKS'];
/** School colours: [primary, secondary]. */
const COLORS: [string, string][] = [
  ['#c8102e', '#ffffff'], ['#00205b', '#ffc72c'], ['#006747', '#ffffff'], ['#4b2e83', '#ffd100'], ['#f47321', '#1d2b53'],
  ['#000000', '#ffc72c'], ['#7a0019', '#ffcc33'], ['#003087', '#c8102e'], ['#154734', '#ffb81c'], ['#582c83', '#ffffff'],
  ['#9e1b32', '#8a8d8f'], ['#0033a0', '#ffffff'], ['#ba0c2f', '#000000'], ['#002f6c', '#7ba4db'], ['#ffb81c', '#000000'],
  ['#00843d', '#ffd100'], ['#6f263d', '#a2aaad'], ['#e35205', '#ffffff'], ['#13294b', '#e84a27'], ['#8c1d40', '#ffc627'],
];

export interface SchoolIdentity { name: string; mascot: string; abbr: string; colors: [string, string] }

/** n distinct schools for a state. */
export function makeSchools(state: StateDef, n: number, rng: Rng): SchoolIdentity[] {
  const out: SchoolIdentity[] = [];
  const used = new Set<string>(), abbrs = new Set<string>(), mascots = new Set<string>();
  let guard = 0;
  while (out.length < n && guard++ < 5000) {
    const reg = rng.next() < 0.8 ? state.region : rng.pick(Object.keys(PREFIX) as Region[]);
    let name = rng.pick(PREFIX[reg]) + rng.pick(SUFFIX[reg]);
    if (rng.next() < 0.12) name = `${rng.pick(DIRECTION)} ${name}`;
    const words = name.split(' ');
    if (name.length > 14 || used.has(name) || new Set(words).size < words.length) continue; // no STAR STAR
    const mascot = rng.pick(MASCOTS);
    if (mascots.has(mascot) && mascots.size < MASCOTS.length - 4) continue;
    const abbr = makeAbbr(name, abbrs);
    used.add(name); mascots.add(mascot); abbrs.add(abbr);
    out.push({ name, mascot, abbr, colors: rng.pick(COLORS) });
  }
  return out;
}

function makeAbbr(name: string, used: Set<string>): string {
  const words = name.split(' ');
  const letters = name.replace(/[^A-Z]/g, '');
  const tries = [
    words.length > 1 ? (words[0][0] + words[1].slice(0, 2)) : letters.slice(0, 3),
    letters[0] + letters.slice(2, 4), letters[0] + letters[1] + letters[letters.length - 1],
    letters.slice(0, 2) + letters[letters.length - 1],
  ];
  for (const t of tries) if (t.length === 3 && !used.has(t)) return t;
  for (let i = 0; i < 26; i++) { const t = letters.slice(0, 2) + String.fromCharCode(65 + i); if (!used.has(t)) return t; }
  return letters.slice(0, 3);
}

const FIRST_NAMES = ['JAKE', 'MASON', 'TYLER', 'CALEB', 'EVAN', 'JALEN', 'CADE', 'BRYCE', 'DREW', 'LUKE', 'NOAH', 'COLE',
  'JAYDEN', 'MARCUS', 'TRENT', 'GAVIN', 'MILES', 'RHETT', 'BRADY', 'DANTE', 'KOBE', 'ISAIAH', 'QUINN', 'REID', 'SETH',
  'TRAVIS', 'XAVIER', 'ZACH', 'AIDEN', 'BEAU', 'CARTER', 'DEREK', 'ELI', 'GRANT', 'HUNTER', 'JAMAL', 'KYLE', 'LOGAN'];
const LAST_NAMES = ['MOORE', 'HAYES', 'PRICE', 'BROOKS', 'WARD', 'FOSTER', 'GRAY', 'BELL', 'REED', 'COLE', 'LANE', 'WEST',
  'STONE', 'NASH', 'BURKE', 'HALE', 'CROSS', 'FORD', 'DEAN', 'MARSH', 'HART', 'RHODES', 'BOONE', 'DRAKE', 'FROST', 'GAINES',
  'HOLT', 'KNOX', 'LOWE', 'MAYS', 'NOLAN', 'OWENS', 'QUINN', 'SHAW', 'TATE', 'VANCE', 'WADE', 'YATES', 'ELLIS', 'FLYNN',
  'CARTER', 'JOHNSON', 'WILLIAMS', 'DAVIS', 'MILLER', 'TAYLOR', 'THOMAS', 'JACKSON', 'WHITE', 'HARRIS', 'MARTIN', 'WALKER'];
export const randomName = (): { first: string; last: string } => ({
  first: FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)],
  last: LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)],
});
