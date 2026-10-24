// Pixel-art planet texture: terrain, vegetation, craters, scorch marks and subtle territory borders.

import type { WorldState } from '../game/types';
import { GRASS_MAX, isWaterType } from '../game/world';

export const CELL_PX = 4;


type RGB = [number, number, number];
const hex = (h: string): RGB => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

const PAL: Record<string, RGB[]> = {
  deepOcean: ['#0a2540', '#0e2f52', '#082036'].map(hex),
  shallowOcean: ['#15507a', '#1d5e8e', '#114566'].map(hex),
  beach: ['#d8c188', '#c8af75', '#e6d19c'].map(hex),
  plains: ['#6ea85a', '#5e9848', '#7cba68'].map(hex),
  forest: ['#2e6b34', '#26592c', '#3a7c42'].map(hex),
  mountain: ['#6b5d4e', '#554838', '#8a7a68'].map(hex),
  fertile: ['#84b866', '#76a75a', '#97ca76'].map(hex),
};
const DRY = hex('#a8905a');
const TREE = hex('#1f4d27');
const SCAR = hex('#2b2119');
const RUBBLE = hex('#8c7d69');
const SOOT = hex('#141210');

function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) & 255;
}
// A texture is cached per canvas, never reused across differently-sized planets.
const caches = new WeakMap<HTMLCanvasElement, { image: ImageData; a: Uint8Array; b: Uint8Array; signatures: Int32Array }>();
export function renderTerrainTexture(ctx: CanvasRenderingContext2D, s: WorldState): void {
  const GRID_W = s.width, GRID_H = s.height, TEX_W = GRID_W * CELL_PX, TEX_H = GRID_H * CELL_PX;
  let cache = caches.get(ctx.canvas);
  if (!cache || cache.image.width !== TEX_W || cache.image.height !== TEX_H) {
    const a = new Uint8Array(TEX_W * TEX_H), b = new Uint8Array(TEX_W * TEX_H);
    for (let y=0;y<TEX_H;y++) for(let x=0;x<TEX_W;x++) { a[y*TEX_W+x]=hash(x,y,1); b[y*TEX_W+x]=hash(x,y,2); }
    cache = { image: ctx.createImageData(TEX_W,TEX_H), a, b, signatures: new Int32Array(s.cells.length).fill(-1) };
    caches.set(ctx.canvas,cache);
  }
  const { image: img, a: NOISE_A, b: NOISE_B } = cache;
  const d = img.data;
  const civRgb = new Map<number, RGB>();
  for (const c of Object.values(s.civs)) if (c.alive) civRgb.set(c.idx, hex(c.color));
  const owner = (gx: number, gy: number): number => {
    if (gy < 0 || gy >= GRID_H) return -2;
    const i = gy * GRID_W + ((gx + GRID_W) % GRID_W);
    return isWaterType(s.cells[i].type) ? -2 : s.territory[i];
  };

  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const id = gy * GRID_W + gx;
      const c = s.cells[id];
      const pal = PAL[c.type];
      const land = !isWaterType(c.type);
      const own = land ? s.territory[id] : -1;
      const tint = own >= 0 ? civRgb.get(own) : undefined;
      const gmax = GRASS_MAX[c.type];
      const dry = land && gmax > 0.3 ? Math.max(0, 1 - c.grass / gmax, c.drought) * 0.5 : 0;
      const bl = tint ? own !== owner(gx - 1, gy) && owner(gx - 1, gy) !== -2 : false;
      const br = tint ? own !== owner(gx + 1, gy) && owner(gx + 1, gy) !== -2 : false;
      const bt = tint ? own !== owner(gx, gy - 1) && owner(gx, gy - 1) !== -2 : false;
      const bb = tint ? own !== owner(gx, gy + 1) && owner(gx, gy + 1) !== -2 : false;

      const signature = (c.type === 'deepOcean' ? 1 : c.type === 'shallowOcean' ? 2 : c.type === 'beach' ? 3 : c.type === 'plains' ? 4 : c.type === 'forest' ? 5 : c.type === 'mountain' ? 6 : 7)
        + c.trees * 8 + Math.round(dry*15)*64 + Math.round(c.crater*15)*1024 + Math.round(c.scorch*15)*16384
        + (own+1)*262144 + (Number(bl)+2*Number(br)+4*Number(bt)+8*Number(bb))*16777216;
      if (cache.signatures[id] === signature) continue;
      cache.signatures[id] = signature;
      for (let j = 0; j < CELL_PX; j++) {
        for (let i = 0; i < CELL_PX; i++) {
          const px = gx * CELL_PX + i, py = gy * CELL_PX + j;
          const pi = py * TEX_W + px;
          const n = NOISE_A[pi];
          const base = n < 64 ? pal[1] : n < 89 ? pal[2] : pal[0];
          let r = base[0], g = base[1], b = base[2];
          if (dry > 0) { r += (DRY[0] - r) * dry; g += (DRY[1] - g) * dry; b += (DRY[2] - b) * dry; }
          if (land && c.trees > 0 && NOISE_B[pi] < c.trees * 38) { r = TREE[0]; g = TREE[1]; b = TREE[2]; }
          if (c.crater > 0.1) {
            const k = Math.min(1, c.crater) * 0.82;
            r += (SCAR[0] - r) * k; g += (SCAR[1] - g) * k; b += (SCAR[2] - b) * k;
            if (NOISE_B[pi] > 232) { r += (RUBBLE[0] - r) * 0.55; g += (RUBBLE[1] - g) * 0.55; b += (RUBBLE[2] - b) * 0.55; }
          }
          if (c.scorch > 0.04) {
            const k = Math.min(0.85, c.scorch);
            r += (SOOT[0] - r) * k; g += (SOOT[1] - g) * k; b += (SOOT[2] - b) * k;
          }
          if (tint) {
            let k = 0.12;
            if ((i === 0 && bl) || (i === CELL_PX - 1 && br) || (j === 0 && bt) || (j === CELL_PX - 1 && bb)) k = 0.78;
            r += (tint[0] - r) * k; g += (tint[1] - g) * k; b += (tint[2] - b) * k;
          }
          const o = pi * 4;
          d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}
