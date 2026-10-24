// Name generation for citizens, worlds, civilizations and settlements

import { mulberry32 } from './world';

const prefixes = ['Mor', 'El', 'Kae', 'Ri', 'Tan', 'Vin', 'Os', 'Lu', 'Ber', 'Fal', 'Ith', 'Nym', 'Ari', 'Sol', 'Wen', 'Jor', 'Pyr', 'Dor', 'Ash', 'Mira', 'Cor', 'Zeph', 'Hal', 'Ez', 'Tha'];
const suffixes = ['wen', 'ra', 'don', 'th', 'la', 'mir', 'ven', 'or', 'na', 'rik', 'sa', 'mel', 'rin', 'dor', 'ka', 'lis', 'ben', 'tor', 'ni', 'va'];

const worldAdj = ['Moss', 'Silver', 'Quiet', 'Green', 'Amber', 'Still', 'Golden', 'Drift', 'Copper', 'Cedar', 'Fern', 'Ashen', 'Dew', 'Ember', 'Hollow', 'Iron', 'Linden', 'Mist', 'Oak', 'Pale', 'Rain', 'Sable', 'Woven', 'Thorn', 'Wild'];
const worldNoun = ['fall', 'mead', 'hollow', 'field', 'creek', 'haven', 'reach', 'shore', 'rest', 'grove', 'moor', 'well', 'ford', 'gate', 'hearth', 'vale', 'brook', 'holm', 'stone', 'watch', 'light', 'bloom', 'keep', 'ridge', 'song'];
const civRoots = ['Ash', 'Brin', 'Cael', 'Dun', 'Eld', 'Fenn', 'Gor', 'Hale', 'Isk', 'Jor', 'Kell', 'Lor', 'Morn', 'Nor', 'Orin', 'Pell', 'Rav', 'Sunn', 'Tarn', 'Ulm', 'Vael', 'Wyn'];
const civEnds = ['folk', 'hold', 'mark', 'vale', 'gard', 'haven', 'kin', 'moor'];

export function generateName(seed?: number): string {
  const rng = seed !== undefined ? mulberry32(seed) : Math.random;
  const p = prefixes[Math.floor(rng() * prefixes.length)];
  const s = suffixes[Math.floor(rng() * suffixes.length)];
  return p + s;
}

export function generateWorldName(seed?: number): string {
  const rng = seed !== undefined ? mulberry32(seed) : Math.random;
  const a = worldAdj[Math.floor(rng() * worldAdj.length)];
  const n = worldNoun[Math.floor(rng() * worldNoun.length)];
  return a + n;
}

export const settlementNames = ['Hearth', 'Grove', 'Brook', 'Stone', 'Meadow', 'Glen', 'Fell', 'Coppice', 'Dell', 'Hollow'];

export function generateSettlementName(seed: number): string {
  const rng = mulberry32(seed);
  const a = worldAdj[Math.floor(rng() * worldAdj.length)];
  const n = settlementNames[Math.floor(rng() * settlementNames.length)];
  return a + n;
}

export function generateCivName(seed: number): string {
  const rng = mulberry32(seed);
  return civRoots[Math.floor(rng() * civRoots.length)] + civEnds[Math.floor(rng() * civEnds.length)];
}
