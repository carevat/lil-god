import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createNewWorld } from '../game/newWorld';
import { createInitialState } from '../game/state';
import { DEFAULT_WORLD, GENERATION, WORLD_SIZES, targetCivilizations, type CivDensity } from '../game/scale';
import { gridFor } from '../game/grid';
import { analyseGeography } from '../game/geography';
import { cellDistance, cellsWithin, cellUnit, isHumanSpawnCell, latLonToCell, neighbors, sphereDist, vec3ToLatLon } from '../game/world';
import { castLightning, castMeteor, castRain, castNature, castTerraform, castSeedCiv, castSpawn, updateMeteors } from '../game/powers';
import { performVision } from '../game/vision';
import { roleOf } from '../game/authority';
import { resetAnims } from '../game/combat';
import { createBuilding } from '../game/buildings';
import { createHuman, killEntity, refreshCounts } from '../game/lifecycle';
import { giveBirth } from '../game/humans';
import { routeTo, moveEntity } from '../game/pathing';
import { advanceClock } from '../game/clock';
import { tick } from '../game/simulation';
import { migrateSave, SAVE_VERSION } from '../game/migrate';
import { serialize, packSave, unpackSave } from '../game/persistence';
import { configureSurface, cellPos, entityPos, ringPositions, renderSurface } from '../rendering/shared';
import { overviewDistance } from '../rendering/WorldCamera';
import { useGame } from '../game/store';
import { mkCiv, base, flatten, eastOf } from './helpers';
import { declareWar } from '../game/civ';

beforeEach(() => resetAnims());

describe('actual world scale', () => {
  it('has four times the original physical surface and many more habitable tiles', () => {
    const old = createInitialState(12), bigger = createNewWorld(12);
    expect(bigger.cells.length / old.cells.length).toBe(4);
    expect(bigger.radius ** 2 / old.radius ** 2).toBe(4);
    expect(bigger.cells.filter(isHumanSpawnCell).length).toBeGreaterThan(old.cells.filter(isHumanSpawnCell).length * 3);
    expect(new Set(Object.values(bigger.civs).map(c=>c.color)).size).toBe(Object.keys(bigger.civs).length);
    expect(Object.values(bigger.civs).every(c=>c.kingId && bigger.citizens[c.kingId].civId===c.id)).toBe(true);
  });

  it('all size and density settings alter real terrain capacity and the initial population', () => {
    for(const size of ['small','standard','large'] as const) {
      const counts: number[]=[];
      for(const density of ['sparse','normal','dense'] as CivDensity[]) {
        const w=createNewWorld(804,'balanced',{size,density});
        expect(w.cells.length).toBe(WORLD_SIZES[size].width * WORLD_SIZES[size].height);
        const n=Object.keys(w.civs).length;
        expect(n).toBeLessThanOrEqual(targetCivilizations({size,density}));
        expect(n).toBeGreaterThan(0);
        expect(w.population).toBe(n*GENERATION.founders);
        expect(new Set(Object.values(w.settlements).map(t=>t.cellId)).size).toBe(n);
        expect(Object.values(w.citizens).every(c=>Math.abs(w.cells[c.cellId].lat)<=.82)).toBe(true);
        counts.push(n);
      }
      expect(counts[1]).toBeGreaterThan(counts[0]);
      expect(counts[2]).toBeGreaterThan(counts[1]);
    }
  },60000);

  it('is deterministic, bounded, and retains islands alongside major landmasses', () => {
    const a=createNewWorld(42), b=createNewWorld(42);
    expect(a).toEqual(b);
    for (const preset of ['lush','balanced','harsh'] as const) {
      const w=createNewWorld(19,preset);
      const g=analyseGeography(w.cells);
      expect(w.generation.attempt).toBeLessThan(GENERATION.maxAttempts);
      expect(g.regions.filter(r=>r.area>200).length).toBeGreaterThanOrEqual(2);
      expect(g.regions.some(r=>r.area<100 && r.area>4)).toBe(true);
      expect(Math.max(...g.regions.map(r=>r.area))/g.landArea).toBeLessThan(.7);
    }
  });

  it('allows additional civilizations beyond the initial target when suitable space remains', () => {
    const w=createNewWorld(42);
    const before=Object.keys(w.civs).length;
    expect(before).toBe(16);
    w.divineEnergy=100;
    const result=castSeedCiv(w);
    expect(result.ok).toBe(true);
    expect(Object.keys(w.civs)).toHaveLength(before+1);
  });
});

describe('multi-size coordinates and rendering', () => {
  it('maps every cell to the same spherical convention, including the longitude seam', () => {
    for (const size of Object.values(WORLD_SIZES)) {
      const grid=gridFor(size);
      for(let id=0;id<grid.count;id+=17) {
        const p=cellUnit(id,size), ll=vec3ToLatLon(...p);
        expect(latLonToCell(ll.lat,ll.lon,size)).toBe(id);
        expect(Math.hypot(...p)).toBeCloseTo(1,12);
        for(const n of neighbors(id,size)) expect(n).toBeLessThan(grid.count);
      }
      const row=Math.floor(size.height/2);
      const a=grid.index(0,row), b=grid.index(size.width-1,row);
      expect(neighbors(a,size)).toContain(b);
      expect(sphereDist(a,b,size)).toBeLessThan(1.01);
      expect(cellDistance(a,b,size)).toBe(1);
      for(const id of cellsWithin(a,3.5,size)) expect(sphereDist(a,id,size)).toBeLessThanOrEqual(3.500001);
    }
  });

  it('keeps creatures, buildings, crowns and effect rings on each differently sized sphere', () => {
    for (const size of ['small','standard','large'] as const) {
      const w=createNewWorld(804,'balanced',{size,density:'sparse'});
      configureSurface(w);
      const h=Object.values(w.citizens)[0];
      const n=neighbors(h.cellId,w).find(id=>!w.cells[id].type.includes('Ocean'))!;
      h.targetCellId=n; h.moveProgress=.5;
      const p=entityPos(h,new THREE.Vector3());
      expect(p.length()).toBeCloseTo(w.radius+.02,5);
      expect(cellPos(h.cellId,1).length()).toBeCloseTo(w.radius,5);
      const ring=new Float32Array(72*3); ringPositions(ring,h.cellId,3.5);
      for(let i=0;i<ring.length;i+=3) expect(Math.hypot(ring[i],ring[i+1],ring[i+2])).toBeCloseTo(w.radius+.06,4);
      expect(renderSurface.width).toBe(w.width);
      expect(overviewDistance(w.radius,16/9)).toBeGreaterThan(w.radius*2);
      expect(overviewDistance(w.radius,390/844)).toBeGreaterThan(overviewDistance(w.radius,16/9));
    }
    configureSurface(null);
  });

  it('never lets route-cache reuse skip terrain cells or mutate another unit path', () => {
    const w=createNewWorld(42), st=Object.values(w.settlements)[0];
    const a=createHuman(w,st.cellId), b=createHuman(w,st.cellId);
    const goal=cellsWithin(st.cellId,6,w).find(id=>isHumanSpawnCell(w.cells[id])&&cellDistance(st.cellId,id,w)>4)!;
    w.pathBudget=100;
    expect(routeTo(w,a,goal)).toBe('ok');
    const initial=a.path.slice();
    moveEntity(w,a,3,1);
    expect(routeTo(w,b,goal)).toBe('ok');
    expect(b.path).toEqual(initial);
    let prev=b.cellId;
    for(const next of b.path) { expect(neighbors(prev,w)).toContain(next); prev=next; }
  });
});

describe('all existing systems on the expanded grid', () => {
  it('uses real Divine Vision, diplomacy, combat, and succession for factions beyond the old six', () => {
    const w=createNewWorld(42), factions=Object.values(w.civs);
    const A=factions[8], B=factions[13];
    const king=w.citizens[A.kingId!];
    expect(performVision(w,king.id,B.id).war).toBe(true);
    expect(Object.values(w.relations).some(r=>r.status==='war' && [r.a,r.b].includes(A.id)&&[r.a,r.b].includes(B.id))).toBe(true);
    killEntity(w,king,'battle');
    expect(A.succession.phase).toBe('panic');
    let acc=0;
    for(let i=0;i<20;i++) acc=advanceClock(w,100,8,acc).acc;
    expect(A.succession.phase).toBe('stable');
    expect(A.kingId).not.toBe(king.id);
    expect(roleOf(w,w.citizens[A.kingId!])).toBe('king');
  });

  it('applies births, lethal lightning, meteor scars, rain, vegetation and wildlife at high cell IDs', () => {
    const w=createNewWorld(42);
    const st=Object.values(w.settlements).find(st=>st.cellId>10000)!;
    const civ=w.civs[st.civId];
    const cell=cellsWithin(st.cellId,6,w).find(id=>isHumanSpawnCell(w.cells[id])&&sphereDist(st.cellId,id,w)>4)!;
    const child=createHuman(w,cell,{age:0,civId:civ.id});
    const mother=Object.values(w.citizens).find(c=>c.civId===civ.id&&c.gender==='f')!;
    const father=Object.values(w.citizens).find(c=>c.civId===civ.id&&c.gender==='m')!;
    mother.partnerId=father.id; father.partnerId=mother.id;
    civ.housing.capacity=20; civ.resources.food=60;
    expect(giveBirth(w,mother)?.cellId).toBeGreaterThan(4608);
    expect(castLightning(w,cell).ok).toBe(true);
    expect(child.alive).toBe(false);
    const b=createBuilding(w,'shelter',cell,civ.id,st.id);
    w.divineEnergy=100;
    expect(castMeteor(w,cell).ok).toBe(true);
    updateMeteors(w,3);
    expect(w.cells[cell].crater).toBeGreaterThan(.5);
    expect(w.buildings[b.id]).toBeUndefined();
    w.divineEnergy=100; w.powerCd={};
    expect(castRain(w,cell).ok).toBe(true);
    expect(castNature(w,st.cellId).ok).toBe(true);
    const wild=castSpawn(w,'deer',st.cellId); expect(wild.ok).toBe(true);
    expect(Object.values(w.creatures).every(c=>c.cellId>4608)).toBe(true);
    const terra=cellsWithin(st.cellId,5,w).find(i=>!w.cells[i].buildingId)!;
    w.divineEnergy=100; expect(castTerraform(w,terra,true).ok).toBe(true);
    refreshCounts(w);
  });
});

describe('world-scale saves', () => {
  it('preserves a populated v4 save including wars, royalty, scars and an unfinished succession', () => {
    const {s,start}=base(12); flatten(s,start,18);
    const a=mkCiv(s,start,8), b=mkCiv(s,eastOf(start,12),8);
    declareWar(s,a.civ,b.civ,'legacy war');
    const king=s.citizens[a.civ.kingId!]; killEntity(s,king,'test');
    s.cells[start+3].crater=.75;
    const raw=JSON.parse(serialize(s,true)); raw.version=4;
    delete raw.state.radius; delete raw.state.generation;
    delete raw.state.ecologyPhase; delete raw.state.ecologyElapsed; delete raw.state.ecologyRevision;
    const original=structuredClone(raw.state);
    const res=migrateSave(raw);
    expect(res.ok).toBe(true); if(!res.ok)return;
    const l=res.data.state;
    expect(l.cells).toEqual(original.cells);
    expect(l.citizens).toEqual(original.citizens);
    expect(l.settlements).toEqual(original.settlements);
    expect(l.relations).toEqual(original.relations);
    expect(l.events).toEqual(original.events);
    expect(l.civs[a.civ.id].succession).toEqual(original.civs[a.civ.id].succession);
    expect(l.civs[b.civ.id].kingId).toBe(b.civ.kingId);
    expect(l.width).toBe(96); expect(l.radius).toBe(5);
  });
  it('loads old worlds without resizing, re-seeding, or losing active events and people', () => {
    const w=createInitialState(12);
    const raw=JSON.parse(serialize(w,true)); raw.version=4;
    delete raw.state.radius; delete raw.state.generation;
    const terrain=JSON.stringify(raw.state.cells);
    const r=migrateSave(raw);
    expect(r.ok).toBe(true); if(!r.ok)return;
    expect(r.data.version).toBe(SAVE_VERSION);
    expect(r.data.state.width).toBe(96); expect(r.data.state.height).toBe(48); expect(r.data.state.radius).toBe(5);
    expect(JSON.stringify(r.data.state.cells)).toBe(terrain);
    expect(r.data.state.generation.size).toBe('legacy');
    expect(Object.keys(r.data.state.civs)).toHaveLength(0);
  });

  it('compresses and restores Large saves below storage quota without deleting terrain or factions', () => {
    const w=createNewWorld(12,'lush',{size:'large',density:'dense'});
    const json=serialize(w,true), compressed=packSave(json);
    expect(compressed.length).toBeLessThan(2_000_000);
    expect(unpackSave(compressed)).toBe(json);
    expect(unpackSave(json)).toBe(json);
    const r=migrateSave(JSON.parse(unpackSave(compressed)));
    expect(r.ok).toBe(true); if(!r.ok)return;
    const l=r.data.state;
    expect(l.width).toBe(w.width); expect(l.radius).toBe(w.radius); expect(l.cells.length).toBe(w.cells.length);
    expect(Object.keys(l.civs)).toEqual(Object.keys(w.civs));
    for(const c of Object.values(w.citizens)) expect(l.citizens[c.id].authority).toBe(c.authority);
    tick(l);
    expect(l.population).toBeGreaterThan(50);
    console.log('LARGE SAVE',JSON.stringify({jsonBytes:json.length,storedBytes:compressed.length}));
  });

  it('rejects dimensions that do not match the saved cells', () => {
    const raw=JSON.parse(serialize(createInitialState(42),false)); raw.state.width=192;
    expect(migrateSave(raw).ok).toBe(false);
  });

  it('stores camera focus requests without changing simulation speed or state', () => {
    const world=createNewWorld(12,'balanced',DEFAULT_WORLD);
    useGame.getState().replaceWorld(world,true);
    const h=Object.values(world.citizens)[0];
    useGame.getState().setSpeed(3);
    useGame.getState().focusOn(h.cellId,h.id);
    expect(useGame.getState().cameraRequest?.entityId).toBe(h.id);
    expect(useGame.getState().speed).toBe(3);
    useGame.getState().overview();
    expect(useGame.getState().cameraRequest?.mode).toBe('overview');
    expect(world.day).toBe(0);
  });
});