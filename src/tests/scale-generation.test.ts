import { describe, expect, it } from 'vitest';
import { createNewWorld } from '../game/newWorld';
import { analyseGeography } from '../game/geography';
import { tick } from '../game/simulation';
import { gridFor } from '../game/grid';
import { isHumanSpawnCell } from '../game/world';
import { DENSITIES } from '../game/scale';
import { createHuman, refreshCounts, createCreature } from '../game/lifecycle';
import { declareWar, updateTerritory } from '../game/civ';

describe('expanded geography', () => {
  it('creates distributed Standard civilizations on valid, well-spaced land', () => {
    for (const seed of [1,12,42,99,804]) {
      const t = performance.now();
      const w = createNewWorld(seed);
      const geo = analyseGeography(w.cells), grid = gridFor(w);
      const sites = Object.values(w.settlements).map(s=>s.cellId);
      console.log('STANDARD', JSON.stringify({seed, cells:w.cells.length, civs:sites.length, regions:w.generation.inhabitedRegions,
        land:Math.round(geo.landArea), majorRegions:geo.regions.filter(r=>r.area>100).length,
        largestShare:Math.max(...geo.regions.map(r=>r.area))/geo.landArea, ms:Math.round(performance.now()-t)}));
      expect(w.cells.length).toBe(18432);
      expect(w.radius).toBe(10);
      expect(sites.length).toBeGreaterThanOrEqual(10);
      expect(w.generation.inhabitedRegions).toBeGreaterThanOrEqual(3);
      for (let i=0;i<sites.length;i++) {
        expect(isHumanSpawnCell(w.cells[sites[i]])).toBe(true);
        for(let j=i+1;j<sites.length;j++) expect(grid.distance(sites[i],sites[j])).toBeGreaterThanOrEqual(DENSITIES.normal.spacing);
      }
    }
  }, 60000);
  it('profiles expanded normal simulation', () => {
    const s = createNewWorld(12);
    for(let i=0;i<48;i++) tick(s);
    const times: number[]=[];
    for(let i=0;i<192;i++){const t=performance.now();tick(s);times.push(performance.now()-t);}
    times.sort((a,b)=>a-b);
    console.log('EXPANDED PROFILE',JSON.stringify({cells:s.cells.length,civs:Object.keys(s.civs).length,humans:s.population,
      meanMs:times.reduce((a,b)=>a+b,0)/times.length,p95Ms:times[Math.floor(times.length*.95)]}));
    expect(s.population).toBeGreaterThan(0);
  },60000);
  it('measures a grown, densely populated Large world with multiple active wars', () => {
    const s = createNewWorld(42,'balanced',{size:'large',density:'dense'});
    for (const civ of Object.values(s.civs)) {
      const st = s.settlements[civ.capitalId!];
      for(let i=0;i<14;i++) createHuman(s,st.cellId,{civId:civ.id,gender:i%2?'m':'f'});
      civ.resources.food = 100; civ.resources.wood = 100;
      let n=0;
      for(const c of Object.values(s.citizens)) if(c.civId===civ.id && n++<5)c.role='soldier';
    }
    refreshCounts(s);
    const civs = Object.values(s.civs);
    // Put actual opposing forces at shared borders so this measures combat, not only war flags.
    for(let i=0;i<8;i+=2) {
      declareWar(s,civs[i],civs[i+1],'benchmark');
      const arena=s.settlements[civs[i].capitalId!].cellId;
      for(const h of Object.values(s.citizens)) if((h.civId===civs[i].id||h.civId===civs[i+1].id)&&h.role==='soldier') h.cellId=arena;
    }
    for (let i=0;i<80;i++) createCreature(s,i%3===0?'wolf':'deer',Object.values(s.settlements)[i%civs.length].cellId);
    for(let i=0;i<48;i++)tick(s);
    const times:number[]=[];
    for(let i=0;i<192;i++){ const t=performance.now();tick(s);times.push(performance.now()-t); }
    times.sort((a,b)=>a-b);
    const t=performance.now(); for(let i=0;i<50;i++)updateTerritory(s);
    console.log('DENSE LARGE PROFILE',JSON.stringify({cells:s.cells.length,civs:civs.length,population:s.population,wildlife:Object.keys(s.creatures).length,
      meanMs:times.reduce((a,b)=>a+b,0)/times.length,p95Ms:times[Math.floor(times.length*.95)],territoryMs:(performance.now()-t)/50,warDeaths:s.stats.warDeaths}));
    expect(civs.length).toBeGreaterThanOrEqual(20);
    expect(s.population).toBeGreaterThan(350);
    expect(s.stats.warDeaths).toBeGreaterThan(0);
    expect(times.reduce((a,b)=>a+b,0)/times.length).toBeLessThan(35);
  },60000);
  it('every civilization continues developing through days of accelerated simulation', () => {
    const s=createNewWorld(804);
    const ids=Object.keys(s.civs);
    for(let i=0;i<24*4*12;i++) tick(s);
    const built=Object.values(s.buildings).filter(b=>b.built);
    console.log('DEVELOPMENT',JSON.stringify({days:s.day,pop:s.population,buildings:built.length,
      builders:new Set(built.map(b=>b.civId)).size,births:s.stats.births,deaths:s.stats.deaths}));
    expect(new Set(built.map(b=>b.civId)).size).toBe(ids.length);
    expect(s.stats.births).toBeGreaterThan(0);
    expect(s.population).toBeGreaterThanOrEqual(ids.length*3);
  },60000);
});