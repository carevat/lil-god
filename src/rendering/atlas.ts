// Hand-authored pixel sprites packed into one texture atlas (16x16 tiles, bottom-aligned).
// Magenta (m) pixels are replaced by the owning civilization's colour in the sprite shader.

const PAL: Record<string, string> = {
  k: '#1b1410', s: '#f2c9a0', h: '#4a3220', H: '#d6d6d6', j: '#7a4a22', r: '#ff00ff', q: '#c800c8',
  p: '#2a2f45', b: '#1a1a1a', w: '#f0ece0', g: '#8a8f99', G: '#5d626b', y: '#ffe28a',
  n: '#8a5a32', N: '#5a3820', o: '#c8793a', d: '#a8723c', D: '#7c5128', W: '#efe3cf',
  x: '#8a919c', X: '#555b66', e: '#d64040', a: '#3e8a3e', A: '#2a5830', t: '#6b4a2c', T: '#4a341e',
  l: '#8ac054', c: '#c8a040', m: '#8f8a80', M: '#5a574f', i: '#9ae0ff', z: '#a89a88', Z: '#7d7164',
  v: '#7c4dff', V: '#b9a0ff',
};

export interface SpriteDef { rows: string[]; px: number; anim?: boolean }

const HUMAN = [
  '..hhhh..', '.hhhhhh.', '.hssssh.', '.sskssk.', '.ssssss.', '..rrrr..', '.rrrrrr.', 'srrrrrrs', 's.pppp.s', '..p..p..', '..b..b..',
];
const HUMAN_F = [
  '..jjjj..', '.jjjjjj.', '.jssssj.', '.jsksskj', '.jssssj.', '..rrrr..', '.rrrrrr.', 'srrrrrrs', 's.rrrr.s', '.rrrrrr.', '..b..b..',
];
const CHILD = ['..hh..', '.hhhh.', '.ssss.', '.sksk.', '..rr..', '.rrrr.', '.p..p.', '.b..b.'];
const ELDER = [
  '..HHHH..', '.HHHHHH.', '.HssssH.', '.sskssk.', '.sHHHHs.', '..rrrr..', '.rrrrrr.', 'srrrrrrn', 's.pppp.n', '..p..p.n', '..b..bn.',
];
const SOLDIER = [
  '...ggg..w', '..ggggg.w', '..gsssg.n', '..sksks.n', '.rrggrr.n', 'rrrrrrrsn', 'rrrrrrr.n', 'rrrrrrr.n', '.rrpppr.n', '...p.p..n', '...p.p..n', '..bb.bb.n',
];
const DEER = [
  '........N.N.', '.........NN.', '..dddddd.dd.', '.ddddddddddk', 'ddddddddddd.', 'ddddddddWdd.', 'DddddddDdd..', '.d.d....d.d.', '.D.D....D.D.',
];
const WOLF = [
  '..........XX', '.xxxxxx.xxxx', 'xxxxxxxxxxxk', 'xXxxxxxxxxx.', 'xxxxxxxxxx..', '.x.x...x.x..', '.X.X...X.X..',
];
const RABBIT = ['....z.z.', '....z.z.', '..zzzzzk', '.zzzzzz.', 'Wzzzzzz.', 'WzzzzzZ.', '.z.z.zz.'];
const GOLEM = [
  '...mmmmmm...', '..mmmmmmmm..', '..mmiMMimm..', '..mmmmmmmm..', '.MmmmMMmmmM.', 'mmmmmmmmmmmm', 'mmMmmmmmmMmm', 'mmmmmmmmmmmm',
  'mm.mmmmmm.mm', 'mm.mMMMMm.mm', 'MM..mmmm..MM', '....mm.mm...', '...mmm.mmm..', '...MMM.MMM..',
];
const TREE = [
  '...aaaa...', '..aaAAaa..', '.aaaaAAaa.', '.aAaaaaaA.', 'aaaaAaaaaa', 'aAaaaaaAaa', '.aaaAaaaa.', '..aaaaaa..', '....nn....', '....nN....', '....nN....',
];
const SHELTER = [
  '.......rr.....', '.......r......', '.......o......', '......ooo.....', '.....ooooo....', '....ooooooo...', '...oooooNooo..', '..ooooooNNooo.', '.oooooooNNoooo',
];
const HOUSE = [
  '......rr......', '.....rrrr.....', '....qqqqqq....', '...rrrrrrrr...', '..qqqqqqqqqq..', '.rrrrrrrrrrrr.', '..nnnnnnnnnn..', '..nynnnnnynn..', '..nynnNNnnnn..', '..nnnnNNnnnn..', '..nnnnNNnnnn..', '..TTTTTTTTTT..',
];
const STORAGE = [
  '..rrrrrrrrrr..', '.rrrrrrrrrrrr.', 'nnnnnnnnnnnnnn', 'NNNNNNNNNNNNNN', 'nnnnnnnnnnnnnn', 'NNNNNNnnnNNNNN', 'nnnnnNNNNnnnnn', 'NNNNNNNNNNNNNN', 'nnnnnNNNNnnnnn', 'NNNNNNNNNNNNNN',
];
const COMMUNAL = [
  '.......rr.......', '.......r........', '......cccc......', '....cccccccc....', '..cccccccccccc..', '.cccccccccccccc.', '..nnnnnnnnnnnn..', '..nynnnnnnnynn..', '..nynnNNNNnynn..', '..nnnnNNNNnnnn..', '..nnnnNNNNnnnn..', '..mmmmmmmmmmmm..',
];
const SCAFFOLD = [
  'N............N', 'N............N', 'NNNNNNNNNNNNNN', 'N..N......N..N', 'N..N......N..N', 'NNNNNNNNNNNNNN', 'N............N', 'N............N',
];
const BANNER = ['Nrrrrr.', 'Nrrrrr.', 'Nrrqq..', 'N......', 'N......', 'N......', 'N......', 'N......', 'N......', 'N......'];

function farm(stage: number): string[] {
  const soil = ['tTtTtTtTtTtTtTtT', 'tttttttttttttttt', 'TTTTTTTTTTTTTTTT', 'tttttttttttttttt', 'TTTTTTTTTTTTTTTT'];
  if (stage === 0) return soil;
  const plant = (ch: string) => ('.' + (ch + '..').repeat(5)).padEnd(16, '.');
  if (stage === 1) return [plant('l'), ...soil];
  return [plant('c'), plant('l'), plant('l'), ...soil];
}

export const SPRITES: Record<string, SpriteDef> = {
  human: { rows: HUMAN, px: 0.027, anim: true },
  human_panic: {
    rows: ['s......s.', 's.hhhh.s.', '.hsssshh.', '.hskssh..', '..ssss...', '.rrrrrr..', 'srrrrrrs.', '.pppppp..', '.p..p...', 'b....b...'],
    px: 0.027, anim: true,
  },
  human_f: { rows: HUMAN_F, px: 0.027, anim: true },
  child: { rows: CHILD, px: 0.027, anim: true },
  elder: { rows: ELDER, px: 0.027, anim: true },
  soldier: { rows: SOLDIER, px: 0.027, anim: true },
  deer: { rows: DEER, px: 0.026, anim: true },
  wolf: { rows: WOLF, px: 0.026, anim: true },
  rabbit: { rows: RABBIT, px: 0.024, anim: true },
  golem: { rows: GOLEM, px: 0.03, anim: true },
  tree: { rows: TREE, px: 0.02 },
  shelter: { rows: SHELTER, px: 0.021 },
  house: { rows: HOUSE, px: 0.021 },
  storage: { rows: STORAGE, px: 0.021 },
  communal: { rows: COMMUNAL, px: 0.022 },
  scaffold: { rows: SCAFFOLD, px: 0.021 },
  banner: { rows: BANNER, px: 0.024 },
  farm0: { rows: farm(0), px: 0.021 },
  farm1: { rows: farm(1), px: 0.021 },
  farm2: { rows: farm(2), px: 0.021 },
  crown: { rows: ['y.y.y', 'yyyyy', 'yyyyy', 'ccccc'], px: 0.024 },
  human_windup: {
    rows: ['.......wnn', '..hhhh..n.', '.hhhhhh.n.', '.hssssh.n.', '.sskssk...', '..rrrr....', '.rrrrrr...', 'srrrrrrs..', 's.pppp.s..', '..p..p....', '..b..b....'], px: 0.027,
  },
  human_swing: {
    rows: ['..........', '..hhhh....', '.hhhhhh...', '.hssssh...', '.sskssk.nn', '..rrrr.wnn', '.rrrrrr...', 'srrrrrrs..', 's.pppp.s..', '..p..p....', '..b..b....'], px: 0.027,
  },
  eye: {
    rows: ['...vvvvv...', '..vwwwwwv..', '.vwwwiwwwv.', 'vwwwikiwwwv', '.vwwwiwwwv.', '..vwwwwwv..', '...vvvvv...'], px: 0.03,
  },
  soldier_windup: {
    rows: ['.......wnn', '..ggg..nn.', '..ggggg.n.', '..gsssg.n.', '..sksks...', '.rrggrr...', 'rrrrrrr...', 'rrrrrrr...', 'rrrrrrr...', '.rrpppr...', '...p.p....', '..bb.bb...'], px: 0.027,
  },
  soldier_swing: {
    rows: ['..........', '..ggg.....', '..ggggg...', '..gsssg...', '..sksks.nn', '.rrggrrwnn', 'rrrrrrr...', 'rrrrrrr...', '.rrpppr...', '...p.p....', '..bb.bb...', '..........'], px: 0.027,
  },
  human_hit: {
    rows: ['..hhhh....', '.sshh.....', 'sskss.....', 'ssrrrrr...', '..rrrrrr..', '..rrrrrr..', '..pppp....', '..p..p....', '.b....b...', '..........'], px: 0.027,
  },
  human_down: {
    rows: ['............', '............', '............', '...hhh......', '..sshhrrrrr.', '..pprrrrrrbb', '............', '............'], px: 0.027,
  },
  human_cheer: {
    rows: ['.s......s.', '.shhhhh.s.', '..ssssss..', '..rrrrrr..', '..rrrrrr..', '..pppppp..', '..p....p..', '..b....b..'], px: 0.027,
  },
};

/** Walk-cycle frame: shift the feet row one pixel. */
function frameB(rows: string[]): string[] {
  const out = rows.slice();
  const last = out[out.length - 1];
  out[out.length - 1] = '.' + last.slice(0, -1);
  return out;
}

const TILE = 16;
const COLS = 8;

export interface Atlas {
  canvas: HTMLCanvasElement;
  cols: number;
  rows: number;
  index: Record<string, number>;
}

let atlas: Atlas | null = null;

export function getAtlas(): Atlas {
  if (atlas) return atlas;
  const keys: Array<[string, string[]]> = [];
  for (const [k, def] of Object.entries(SPRITES)) {
    keys.push([k, def.rows]);
    if (def.anim) keys.push([k + '_b', frameB(def.rows)]);
  }
  const rows = Math.ceil(keys.length / COLS);
  const canvas = document.createElement('canvas');
  canvas.width = COLS * TILE;
  canvas.height = rows * TILE;
  const ctx = canvas.getContext('2d')!;
  const index: Record<string, number> = {};
  keys.forEach(([k, spr], i) => {
    index[k] = i;
    const w = Math.max(...spr.map(r => r.length));
    const h = spr.length;
    const ox = (i % COLS) * TILE + Math.floor((TILE - w) / 2);
    const oy = Math.floor(i / COLS) * TILE + (TILE - h);
    spr.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.' || !PAL[ch]) continue;
        ctx.fillStyle = PAL[ch];
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    });
  });
  atlas = { canvas, cols: COLS, rows, index };
  return atlas;
}

/** [u0, v0, du, dv] of a sprite's tile in the (flipY) atlas texture. */
export function spriteUV(a: Atlas, key: string): [number, number, number, number] {
  const i = a.index[key] ?? 0;
  const col = i % a.cols, row = Math.floor(i / a.cols);
  return [col / a.cols, 1 - (row + 1) / a.rows, 1 / a.cols, 1 / a.rows];
}

/** Paint a sprite onto a small canvas for UI previews (civ colour substituted). */
export function drawSpritePreview(canvas: HTMLCanvasElement, key: string, tintHex = '#8BD49A'): void {
  const a = getAtlas();
  const i = a.index[key] ?? 0;
  const sx = (i % a.cols) * TILE, sy = Math.floor(i / a.cols) * TILE;
  const tmp = document.createElement('canvas');
  tmp.width = TILE; tmp.height = TILE;
  const t = tmp.getContext('2d')!;
  t.drawImage(a.canvas, sx, sy, TILE, TILE, 0, 0, TILE, TILE);
  const data = t.getImageData(0, 0, TILE, TILE);
  const n = parseInt(tintHex.slice(1), 16);
  const tr = (n >> 16) & 255, tg = (n >> 8) & 255, tb = n & 255;
  for (let p = 0; p < data.data.length; p += 4) {
    const r = data.data[p], g = data.data[p + 1], b = data.data[p + 2];
    if (r === 255 && g === 0 && b === 255) { data.data[p] = tr; data.data[p + 1] = tg; data.data[p + 2] = tb; }
    else if (r === 200 && g === 0 && b === 200) { data.data[p] = tr * 0.65; data.data[p + 1] = tg * 0.65; data.data[p + 2] = tb * 0.65; }
  }
  t.putImageData(data, 0, 0);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
}
