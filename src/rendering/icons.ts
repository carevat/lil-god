// Original hand-authored pixel-art tool icons.
//
// Every icon is a 16x16 character grid rasterised once into a 32x32 canvas with a hard 2x
// nearest-neighbour scale — no smoothing, no gradients, no CSS drawing. Rows are normalised to
// 16 columns so a hand-editing mistake can never break the grid. '.' means transparent.

export interface IconDef { rows: string[]; pal: Record<string, string> }

// Palette letters: k outline, w white, s/S steel, g/G glass, b/B wood, n/N/M greens,
// c/C cyan, y/Y yellow, o/O/R fire, p/P/V purple, d dim, r tan.
const base: Record<string, string> = {
  k: '#14101a', w: '#f5f7fb', s: '#a8b2c1', S: '#6b7480',
  g: '#a9d8f0', G: '#4f7f9e', b: '#8a5a32', B: '#5a3820',
  n: '#7cba68', N: '#2e6b34', M: '#1c4a22', c: '#7cc8ff', C: '#1d5e8e',
  y: '#ffe27a', Y: '#e0a91f', o: '#ff9a3c', O: '#c2410c', R: '#8a3a1a',
  p: '#8b5cf6', P: '#d5bcff', v: '#7c4dff', V: '#5a2ea6', d: '#4a5568', r: '#e6b96b',
};

const W = 16;
const pad = (rows: string[]) =>
  Array.from({ length: W }, (_, y) => ((rows[y] ?? '').padEnd(W, '.').slice(0, W)));

// ---------- Inspect: magnifying glass ----------
const INSPECT = pad([
  '................',
  '....kkkkkk......',
  '...kSSSSSSk.....',
  '..kSggggggSk....',
  '..kSgwwgggSk....',
  '..kSgwggggSk....',
  '..kSggggggSk....',
  '..kSggggggSk....',
  '..kSSSSSSSk.....',
  '...kkkBBkk......',
  '......kBk.......',
  '.....kBk........',
  '....kBk.........',
  '...kBk..........',
  '..kkk...........',
  '................',
]);

// ---------- Create Life: glowing egg ----------
const LIFE = pad([
  '................',
  '......P.........',
  '.......P........',
  '....kkkkkk......',
  '...kPPPPPPk.....',
  '..kPwwwwwwPk....',
  '..kPwPPPPwPk....',
  '..kPwPyyPwPk....',
  '..kPwPPPPwPk....',
  '..kPwwwwwwPk....',
  '...kPPPPPPk.....',
  '....kkkkkk......',
  '......P.........',
  '.....P..........',
  '................',
  '................',
]);

// ---------- Life Forge: cracked life-seed with a sprout inside ----------
const FORGE = pad([
  '................',
  '..y..........y..',
  '..............y.',
  '....kkkkkkk.....',
  '...kSwwwwwSk....',
  '..kSwNNNwwSk....',
  '..kSwNnNwwSk....',
  '..kSwNNNwwSk....',
  '..kSwwwwwwSk....',
  '...kSwwwSk......',
  '....kkkkk.......',
  '...y......y.....',
  '..y.............',
  '................',
  '................',
  '................',
]);

// ---------- Nature: sprout over soil ----------
const NATURE = pad([
  '................',
  '......kk........',
  '.....knnk.......',
  '....knnnNk......',
  '...knnNnNNk.....',
  '...kNnnnnNk.....',
  '....kNnnNk......',
  '.....kNNk.......',
  '......kBk.......',
  '......kBk.......',
  '......kBk.......',
  '......kBk.......',
  '.....kkkkk......',
  '...kNnNNnNk.....',
  '..kNNNNNNNNk....',
  '...kkkkkkkk.....',
]);

// ---------- Rain: cloud with drops ----------
const RAIN = pad([
  '................',
  '................',
  '.....kkkkk......',
  '...kkCCCCCkk....',
  '..kCCCcccCCCk...',
  '.kCCcccccCCCCk..',
  '.kCcccwwccCCCk..',
  '.kCccccccCCCk...',
  '..kCCCCCCCkk....',
  '....kkkkk.......',
  '................',
  '.....k..k.......',
  '....kcckcck.....',
  '.....k...k......',
  '....kcckcck.....',
  '.....k...k......',
]);

// ---------- Lightning: bolt ----------
const LIGHTNING = pad([
  '................',
  '.........kk.....',
  '........kYYk....',
  '.......kYYk.....',
  '......kYYk......',
  '.....kYYk.......',
  '....kYYkkk......',
  '...kYYkYYkk.....',
  '..kYYkkYYYk.....',
  '..kYk..kYYk.....',
  '.kYk...kYYk.....',
  '.kk.....kYk.....',
  '........kYk.....',
  '.......kYk......',
  '.......kk.......',
  '................',
]);

// ---------- Terraform: shovel over raised ground ----------
const TERRAFORM = pad([
  '................',
  '..........kk....',
  '.........kBk....',
  '........kBk.....',
  '.......kBk......',
  '......kBk.......',
  '.....kBk........',
  '....kBk.........',
  '...kSSSk........',
  '..kSSSSSk.......',
  '..kSSSSSk.......',
  '..kSSSSSk.......',
  '...kkkkk........',
  '..nnn...nnn.....',
  '.kNNNn.nNNNk....',
  '..kkkkkkkkk.....',
]);

// ---------- Meteor: flaming rock ----------
const METEOR = pad([
  '................',
  '..........yy....',
  '.........yYy....',
  '........yYoy....',
  '.......yOoyY....',
  '......yOooyY....',
  '.....yOooyk.....',
  '.....kOOok......',
  '....kORROk......',
  '....kOrRROk.....',
  '....kOrRROk.....',
  '.....kORRk......',
  '......kkkk......',
  '................',
  '................',
  '................',
]);

// ---------- Divine Vision: eye wrapped in dream stars ----------
const VISION = pad([
  '....P......P....',
  '.....P....P.....',
  '......kkkk......',
  '....kkvvvvkk....',
  '...kvwwwwwwvk...',
  '..kvwwPPPPwwvk..',
  '..kvwPPkkPPwvk..',
  '..kvwPPkkPPwvk..',
  '..kvwwPPPPwwvk..',
  '...kvwwwwwwvk...',
  '....kkvvvvkk....',
  '......kkkk......',
  '.....P....P.....',
  '....P......P....',
  '................',
  '................',
]);

// ---------- War: crossed swords (used for military actions) ----------
const WAR = pad([
  '................',
  '..........kk....',
  '.........kSk....',
  '........kSk.....',
  '.......kSk......',
  '..k...kSk.......',
  '..kk.kSk........',
  '...kkSk.........',
  '....kSk.........',
  '...kkSk.........',
  '..kSk.kk........',
  '.kSk...k........',
  'kBk.............',
  'kk..............',
  '................',
  '................',
]);

function tinted(over: Record<string, string>): Record<string, string> {
  return { ...base, ...over };
}

export const ICONS: Record<string, IconDef> = {
  inspect: { rows: INSPECT, pal: tinted({}) },
  life: { rows: LIFE, pal: tinted({ P: '#d5bcff', w: '#fdfbff', y: '#fff3b0' }) },
  forge: { rows: FORGE, pal: tinted({ S: '#b9a0ff', w: '#efe6ff', n: '#9be08a', N: '#2e6b34', y: '#ffe27a' }) },
  nature: { rows: NATURE, pal: tinted({ n: '#8fd47c', N: '#2e6b34', M: '#1c4a22' }) },
  rain: { rows: RAIN, pal: tinted({ c: '#7cc8ff', C: '#1d5e8e', w: '#eaf6ff' }) },
  lightning: { rows: LIGHTNING, pal: tinted({ y: '#ffe27a', Y: '#e0a91f' }) },
  terraform: { rows: TERRAFORM, pal: tinted({ n: '#8a7a68', N: '#554838', S: '#a8b2c1' }) },
  meteor: { rows: METEOR, pal: tinted({ y: '#ffe27a', Y: '#e0a91f', o: '#ff9a3c', O: '#c2410c', R: '#8a3a1a' }) },
  vision: { rows: VISION, pal: tinted({ v: '#7c4dff', P: '#d5bcff', w: '#f4efff' }) },
  war: { rows: WAR, pal: tinted({ B: '#8a5a32' }) },
};

const GRID = 16; // logical pixels per icon
const SCALE = 2; // integer scale -> a 32x32 asset

const cache = new Map<string, HTMLCanvasElement>();

/** Rasterise an icon into a 32x32 canvas (cached). */
export function iconCanvas(name: string, state: 'default' | 'disabled' = 'default'): HTMLCanvasElement {
  const key = name + state;
  const hit = cache.get(key);
  if (hit) return hit;
  const def = ICONS[name] ?? ICONS.inspect;
  const canvas = document.createElement('canvas');
  canvas.width = GRID * SCALE;
  canvas.height = GRID * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < GRID; y++) {
    const row = def.rows[y];
    for (let x = 0; x < GRID; x++) {
      const ch = row[x];
      if (!ch || ch === '.') continue;
      let color = def.pal[ch];
      if (!color) continue;
      if (state === 'disabled') color = desaturate(color);
      ctx.fillStyle = color;
      ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
    }
  }
  cache.set(key, canvas);
  return canvas;
}

function desaturate(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const v = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
  const mix = (c: number) => Math.round(c * 0.4 + v * 0.6);
  const to = (c: number) => c.toString(16).padStart(2, '0');
  return `#${to(mix(r))}${to(mix(g))}${to(mix(b))}`;
}
