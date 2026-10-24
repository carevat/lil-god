// Three.js scene for LITTLE GOD

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import { WorldCamera } from './WorldCamera';
import * as THREE from 'three';
import { useGame } from '../game/store';
import { createInitialState } from '../game/state';
import { vec3ToLatLon, latLonToCell, latLonToVec3, cellUnit, isWaterType } from '../game/world';
import { lifeStage, effectiveCell } from '../game/lifecycle';
import { canPlaceSpecies } from '../game/powers';
import { currentAttack, reactionOf, deathOf } from '../game/combat';
import { roleOf } from '../game/authority';
import { POWERS, METEOR, LIGHTNING } from '../game/config';
import type { Citizen, Living, WorldState } from '../game/types';
import { renderTerrainTexture, CELL_PX } from './terrain';
import { SPRITES } from './atlas';
import { sphereDist } from '../game/world';
import { SpriteBatch, type BatchWriter, type BatchCtx } from './SpriteBatch';
import { drawSpritePreview } from './atlas';
import { P, MAX_PARTICLES, flushBursts, stepParticles } from './particles';
import { PLANET_RADIUS, renderSurface, configureSurface, spriteScale, sunDir, hover, cellPos, entityPos, civTint, idHash, ringPositions } from './shared';

export { PLANET_RADIUS };
let planetObj: THREE.Mesh | null = null;

/** The living human closest to a cell (used by Divine Vision targeting). */
export function nearestHuman(s: WorldState, cell: number, maxDist = 1.8): Citizen | null {
  let best: Citizen | null = null, bd = maxDist;
  for (const c of Object.values(s.citizens)) {
    if (!c.alive) continue;
    const d = sphereDist(cell, effectiveCell(c), s);
    if (d <= bd) { bd = d; best = c; }
  }
  return best;
}

// ============ Planet ============
function Planet() {
  const world = useGame(s => s.world);
  const preview = useMemo(() => createInitialState(12, 'balanced'), []);
  const shown = world ?? preview;
  const { canvas, tex } = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = shown.width * CELL_PX; canvas.height = shown.height * CELL_PX;
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return { canvas, tex };
  }, [shown.width, shown.height]);
  useEffect(() => () => tex.dispose(), [tex]);
  const lastWorld = useRef<WorldState | null>(null);
  const lastVersion = useRef(-1);
  const lastDraw = useRef(0);

  useFrame(state => {
    const v = useGame.getState().simVersion;
    const now = state.clock.elapsedTime;
    const changedWorld = lastWorld.current !== shown;
    if (changedWorld || (v !== lastVersion.current && now - lastDraw.current > 0.6)) {
      renderTerrainTexture(canvas.getContext('2d')!, shown);
      tex.needsUpdate = true;
      lastWorld.current = shown; lastVersion.current = v; lastDraw.current = now;
    }
  });

  // The texture's column 0 sits at longitude -180° in the game's convention; rotate the mesh so
  // raycast hits, sprites and terrain all share one coordinate system.
  return (
    <mesh name="planet" ref={m => { planetObj = m; }} rotation={[0, -Math.PI / 2, 0]}>
      <sphereGeometry args={[shown.radius, Math.max(128, shown.width), Math.max(64, shown.height)]} />
      <meshLambertMaterial map={tex} />
    </mesh>
  );
}

function Atmosphere() {
  const radius = useGame(s => s.world?.radius ?? 5);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vN; void main(){ float i = pow(max(0.0, 0.74 - dot(vN, vec3(0.0,0.0,1.0))), 3.0); gl_FragColor = vec4(0.38, 0.62, 1.0, 1.0) * i; }',
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }), []);
  return (
    <mesh scale={[1.14, 1.14, 1.14]} material={mat}>
      <sphereGeometry args={[radius, 64, 48]} />
    </mesh>
  );
}

// ============ Lighting (sun orbits the planet; dust dims it) ============
function DynamicLighting() {
  const light = useRef<THREE.DirectionalLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  useFrame(() => {
    const w = useGame.getState().world;
    const t = w ? w.timeOfDay : 0.25;
    const a = t * Math.PI * 2;
    sunDir.set(Math.sin(a), 0.28, Math.cos(a)).normalize();
    const dust = w?.dust ?? 0;
    if (light.current) {
      light.current.position.copy(sunDir).multiplyScalar(30);
      light.current.intensity = 2.1 * (1 - 0.35 * dust);
      light.current.color.setRGB(1, 0.95, 0.84);
    }
    if (amb.current) amb.current.intensity = 0.62 * (1 - 0.2 * dust);
  });
  return (
    <>
      <ambientLight ref={amb} intensity={0.62} color="#9fb2ff" />
      <directionalLight ref={light} position={[20, 6, 10]} intensity={2.1} color="#fff2d6" />
    </>
  );
}

// ============ Instanced sprite layers ============
const hv = new THREE.Vector3();
const flipMemory = new Map<string, number>();

function humanKey(c: Citizen): string {
  if (c.task === 'panic') return 'human_panic';
  if (c.role === 'soldier') return 'soldier';
  const st = lifeStage(c);
  if (st === 'child') return 'child';
  if (st === 'elder') return 'elder';
  return c.gender === 'f' ? 'human_f' : 'human';
}

function fillStatic(w: BatchWriter, ctx: BatchCtx) {
  const s = useGame.getState().world;
  if (!s) return;
  if (ctx.camDist - s.radius < 10) {
    for (const c of s.cells) {
      if (c.trees <= 0) continue;
      const unit = cellUnit(c.id,s);
      if (unit[0]*ctx.camDirection.x + unit[1]*ctx.camDirection.y + unit[2]*ctx.camDirection.z < s.radius / ctx.camDist - .04) continue;
      for (let t = 0; t < c.trees; t++) {
        const h1 = ((c.id * 13 + t * 7) % 100) / 100 - 0.5;
        const h2 = ((c.id * 17 + t * 11) % 100) / 100 - 0.5;
        const v = latLonToVec3(c.lat + h1 * (2/s.height) * 0.7, c.lon + h2 * (2/s.width) * 0.7 / Math.max(0.3, Math.cos(c.lat * Math.PI / 2)), PLANET_RADIUS * 1.003);
        w.add('tree', v[0], v[1], v[2], 0.8 + ((c.id + t * 3) % 5) * 0.08);
      }
    }
  }
  for (const b of Object.values(s.buildings)) {
    hv.copy(cellPos(b.cellId, 1.002));
    const tint = civTint(s, b.civId);
    const jx = (idHash(b.id) - 0.5) * 0.08;
    if (!b.built) {
      w.add('scaffold', hv.x + jx, hv.y, hv.z, 1);
      if (b.progress > 0.35) w.add(b.type === 'farm' ? 'farm0' : b.type, hv.x + jx, hv.y, hv.z, 1, tint, Math.min(1, b.progress));
    } else if (b.type === 'farm') {
      const st = (b.cropStage ?? 0);
      w.add(st < 0.34 ? 'farm0' : st < 0.67 ? 'farm1' : 'farm2', hv.x + jx, hv.y, hv.z, 1.15, tint);
    } else {
      w.add(b.type, hv.x + jx, hv.y, hv.z, 1, tint);
    }
  }
  for (const st of Object.values(s.settlements)) {
    hv.copy(cellPos(st.cellId, 1.003));
    w.add('banner', hv.x, hv.y, hv.z, 1.2, civTint(s, st.civId));
  }
}

function pushEntity(w: BatchWriter, ctx: BatchCtx, e: Living, baseKey: string, tint: [number, number, number], scale: number) {
  // Combat / reaction frames override the idle and walk frames.
  const atk = currentAttack(e.id);
  const react = reactionOf(e.id);
  let key = baseKey;
  if (atk) key = SPRITES[`${baseKey}_windup`] ? (atk.phase === 'windup' ? `${baseKey}_windup` : `${baseKey}_swing`) : baseKey;
  else if (react?.kind === 'hit') key = 'human_hit';
  else if (react?.kind === 'cheer') key = 'human_cheer';
  if (!SPRITES[key]) key = baseKey; // creatures keep their own silhouette
  entityPos(e, hv);
  const spread = (idHash(e.id) - 0.5) * 0.12;
  const moving = e.targetCellId !== null;
  if (moving) {
    const tgt = cellUnit(e.targetCellId!,renderSurface);
    const dx = tgt[0] * PLANET_RADIUS - hv.x, dy = tgt[1] * PLANET_RADIUS - hv.y, dz = tgt[2] * PLANET_RADIUS - hv.z;
    const d = dx * ctx.camRight.x + dy * ctx.camRight.y + dz * ctx.camRight.z;
    if (Math.abs(d) > 1e-4) flipMemory.set(e.id, d >= 0 ? 1 : -1);
  }
  const flip = flipMemory.get(e.id) ?? 1;
  const animated = moving && ctx.camDist - PLANET_RADIUS < 12 && Math.floor((useGame.getState().world?.day ?? 0) * 24 * 5 + idHash(e.id) * 3) % 2 === 1;
  const frame = animated && SPRITES[key]?.anim ? key + '_b' : key;
  w.add(frame, hv.x + ctx.camRight.x * spread, hv.y + ctx.camRight.y * spread, hv.z + ctx.camRight.z * spread, scale, tint, 1, flip);
}

function fillDynamic(w: BatchWriter, ctx: BatchCtx) {
  const s = useGame.getState().world;
  if (!s) return;
  if (flipMemory.size > 4000) flipMemory.clear();
  for (const c of Object.values(s.citizens)) {
    const dying = !c.alive && deathOf(c.id);
    if (!c.alive && !dying) continue;
    const key = dying ? 'human_down' : humanKey(c);
    pushEntity(w, ctx, c, key, civTint(s, c.civId), 1);
    // The crown always follows the current king, in life and in battle.
    if (c.alive && roleOf(s, c) === 'king') {
      entityPos(c, hv);
      // Sprites grow with the camera distance clamp, so the crown must move with them and
      // sit exactly on the head (a human sprite is 16 * 0.027 units tall).
      const u = spriteScale(ctx.camDist);
      const fx = useGame.getState().effects.find(e => e.type === 'coronation' && e.cellId === c.cellId);
      const bounce = fx ? Math.max(0, 1 - (performance.now() - fx.createdAt) / fx.duration) * 0.13 : 0;
      const lift = (0.375 + bounce) * u;
      w.add('crown', hv.x + ctx.camUp.x * lift, hv.y + ctx.camUp.y * lift, hv.z + ctx.camUp.z * lift,
        0.72, [1, 1, 1], 1, flipMemory.get(c.id) ?? 1);
    }
  }
  // The fallen crown briefly fades at the site of a succession crisis.
  for (const civ of Object.values(s.civs)) {
    if (civ.succession.phase !== 'panic') continue;
    const former = s.citizens[civ.succession.formerKingId ?? ''];
    if (!former) continue;
    const elapsed = (s.day - civ.succession.startedDay) * 24;
    const alpha = Math.max(0, 0.75 * (1 - elapsed / 9));
    entityPos(former, hv);
    w.add('crown', hv.x + ctx.camUp.x * 0.32, hv.y + ctx.camUp.y * 0.32, hv.z + ctx.camUp.z * 0.32,
      0.7, [1, 1, 1], alpha);
  }
  for (const c of Object.values(s.creatures)) {
    const dying = !c.alive && deathOf(c.id);
    if (!c.alive) continue;
    pushEntity(w, ctx, c, c.species, [1, 1, 1], lifeStage(c) === 'child' ? 0.65 : 1);
    void dying;
  }
}

// ============ Rings drawn on the sphere ============
interface RingState { cell: number; radius: number; opacity: number }

function SphereRing({ getState, color, thick = true }: { getState: () => RingState | null; color: string; thick?: boolean }) {
  const refA = useRef<THREE.LineLoop>(null);
  const refB = useRef<THREE.LineLoop>(null);
  const geoms = useMemo(() => [0, 1].map(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(72 * 3), 3));
    return g;
  }), []);
  const mats = useMemo(() => [0, 1].map(() => new THREE.LineBasicMaterial({ color, transparent: true, depthWrite: false })), [color]);
  useFrame(() => {
    const st = getState();
    const lines = [refA.current, refB.current];
    if (!st) { lines.forEach(l => { if (l) l.visible = false; }); return; }
    lines.forEach((l, i) => {
      if (!l) return;
      l.visible = i === 0 || thick;
      const arr = (geoms[i].attributes.position as THREE.BufferAttribute);
      ringPositions(arr.array as Float32Array, st.cell, st.radius + i * 0.07, 1.012 + i * 0.001);
      arr.needsUpdate = true;
      mats[i].opacity = st.opacity * (i === 0 ? 1 : 0.55);
    });
  });
  return (
    <>
      <lineLoop ref={refA} geometry={geoms[0]} material={mats[0]} frustumCulled={false} />
      <lineLoop ref={refB} geometry={geoms[1]} material={mats[1]} frustumCulled={false} />
    </>
  );
}

function toolMarker(): { radius: number; color: string; valid: boolean; opacity: number } | null {
  const g = useGame.getState();
  const w = g.world;
  if (!w || hover.cell === null || g.tool === 'select') return null;
  const cell = w.cells[hover.cell];
  const water = isWaterType(cell.type);
  let radius = 0.7, color = '#D5BCFF', valid = true, cost = 0;
  switch (g.tool) {
    case 'life': {
      const placement = canPlaceSpecies(w, 'human', hover.cell);
      color = placement.reason && placement.ok ? '#E6B96B' : '#D5BCFF';
      valid = placement.ok; cost = 25; break;
    }
    case 'vision': {
      radius = 1.2; color = '#D5BCFF'; cost = POWERS.vision.cost;
      const g2 = useGame.getState();
      valid = !!nearestHuman(w, hover.cell);
      void g2;
      break;
    }
    case 'forge': {
      const placement = canPlaceSpecies(w, g.forgeSpecies, hover.cell);
      color = placement.reason && placement.ok ? '#E6B96B' : '#8BD49A';
      valid = placement.ok; break;
    }
    case 'nature': radius = POWERS.nature.radius; color = '#8BD49A'; valid = !water && cell.type !== 'mountain'; cost = POWERS.nature.cost; break;
    case 'rain': radius = POWERS.rain.radius; color = '#7cc8ff'; valid = !water; cost = POWERS.rain.cost; break;
    case 'lightning': radius = LIGHTNING.radius; color = '#e8e0ff'; cost = POWERS.lightning.cost; break;
    case 'terraform': radius = 0.7; color = '#E6B96B'; valid = !cell.buildingId; cost = POWERS.terraform.cost; break;
    case 'meteor': radius = g.meteorMode === 'shower' ? METEOR.showerSpread : METEOR.radius; color = '#ff8a3c'; cost = g.meteorMode === 'shower' ? POWERS.shower.cost : POWERS.meteor.cost; break;
  }
  const affordable = w.divineEnergy >= cost;
  return { radius, color: !valid ? '#e65a5a' : !affordable ? '#E6B96B' : color, valid, opacity: valid && affordable ? 0.95 : 0.6 };
}

function HoverMarker() {
  const colorRef = useRef('#D5BCFF');
  const [color, setColor] = useState('#D5BCFF');
  const getState = () => {
    const m = toolMarker();
    if (!m || hover.cell === null) return null;
    if (m.color !== colorRef.current) { colorRef.current = m.color; setColor(m.color); }
    return { cell: hover.cell, radius: m.radius, opacity: m.opacity };
  };
  return <SphereRing key={color} getState={getState} color={color} />;
}

function SelectionMarker() {
  const getState = () => {
    const g = useGame.getState();
    const w = g.world;
    if (!w || !g.selectedEntityId) return null;
    const e = w.citizens[g.selectedEntityId] ?? w.creatures[g.selectedEntityId];
    if (e) return { cell: effectiveCell(e), radius: 0.55, opacity: 0.95 };
    const b = w.buildings[g.selectedEntityId];
    return b ? { cell: b.cellId, radius: 0.6, opacity: 0.95 } : null;
  };
  return <SphereRing getState={getState} color="#D5BCFF" thick={false} />;
}

// ============ Meteors ============
function MeteorVisual({ id }: { id: string }) {
  const group = useRef<THREE.Group>(null);
  const head = useRef<THREE.Mesh>(null);
  const target = useMemo(() => new THREE.Vector3(), []);
  const start = useMemo(() => new THREE.Vector3(), []);
  const n = useMemo(() => new THREE.Vector3(), []);
  const getRing = (scale: number, pulse: number) => () => {
    const m = useGame.getState().world?.meteors.find(x => x.id === id);
    if (!m) return null;
    const t = 1 - m.timeLeft / m.warn;
    return { cell: m.cellId, radius: m.radius * scale, opacity: 0.5 + 0.4 * Math.sin(t * 30 * pulse) ** 2 };
  };
  useFrame(() => {
    const m = useGame.getState().world?.meteors.find(x => x.id === id);
    const g = group.current;
    if (!g) return;
    if (!m) { g.visible = false; return; }
    const t = 1 - m.timeLeft / m.warn;
    const f = Math.max(0, (t - 0.35) / 0.65); // falling phase
    g.visible = f > 0;
    cellPos(m.cellId, 1.0, target);
    n.copy(target).normalize();
    start.copy(target).addScaledVector(n, 9).add(hv.set(n.z, 0, -n.x).normalize().multiplyScalar(5));
    g.position.lerpVectors(start, target, Math.pow(f, 1.6));
    g.lookAt(target);
    if (head.current) head.current.scale.setScalar(0.9 + f * 0.8);
  });
  return (
    <>
      <SphereRing getState={getRing(1, 1)} color="#ff8a3c" />
      <SphereRing getState={getRing(0.5, 1.5)} color="#ffd24a" thick={false} />
      <group ref={group} visible={false}>
        <mesh ref={head}>
          <sphereGeometry args={[0.16, 10, 8]} />
          <meshBasicMaterial color="#ffb347" />
        </mesh>
        <mesh position={[0, 0, -0.7]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.13, 1.5, 8]} />
          <meshBasicMaterial color="#ff6a2a" transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
    </>
  );
}

function MeteorsLayer() {
  useGame(s => s.simVersion);
  const meteors = useGame.getState().world?.meteors ?? [];
  return <>{meteors.map(m => <MeteorVisual key={m.id} id={m.id} />)}</>;
}

// ============ Effects ============
function useFade(createdAt: number, duration: number) {
  return () => Math.min(1, (performance.now() - createdAt) / duration);
}

function ShockRing({ cell, maxRadius, createdAt, duration, color }: { cell: number; maxRadius: number; createdAt: number; duration: number; color: string }) {
  const prog = useFade(createdAt, duration);
  const getState = () => {
    const t = prog();
    if (t >= 1) return null;
    return { cell, radius: Math.max(0.1, maxRadius * (0.15 + t * 0.85)), opacity: 1 - t };
  };
  return <SphereRing getState={getState} color={color} />;
}

function RainEffect({ cell, radius, createdAt, duration }: { cell: number; radius: number; createdAt: number; duration: number }) {
  const group = useRef<THREE.Group>(null);
  const pos = useMemo(() => cellPos(cell, 1.0), [cell]);
  const q = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), pos.clone().normalize()), [pos]);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#7cc8ff', transparent: true, opacity: 0.8 }), []);
  const spread = radius * 0.327 * 0.85;
  const drops = useMemo(() => Array.from({ length: 46 }, (_, i) => ({ x: Math.sin(i * 12.9) * spread, z: Math.cos(i * 7.3 + 1) * spread, o: (i * 0.173) % 1 })), [spread]);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = (performance.now() - createdAt) / duration;
    mat.opacity = t < 0.1 ? t * 8 : Math.max(0, 0.8 * (1 - (t - 0.7) / 0.3));
    const time = performance.now() * 0.0012;
    g.children.forEach((c, i) => {
      const d = drops[i];
      const ph = (time + d.o) % 1;
      c.position.set(d.x, 1.1 * (1 - ph) + 0.05, d.z);
    });
  });
  return (
    <group ref={group} position={pos} quaternion={q}>
      {drops.map((_, i) => (
        <mesh key={i} material={mat}>
          <boxGeometry args={[0.018, 0.1, 0.018]} />
        </mesh>
      ))}
    </group>
  );
}

function LightningBolt({ cell, createdAt }: { cell: number; createdAt: number }) {
  const [alive, setAlive] = useState(true);
  const group = useRef<THREE.Group>(null);
  const light = useRef<THREE.PointLight>(null);
  const segs = useMemo(() => {
    const target = cellPos(cell, 1.0);
    const n = target.clone().normalize();
    const t1 = new THREE.Vector3(-n.z, 0, n.x).normalize();
    const t2 = new THREE.Vector3().crossVectors(n, t1);
    const pts = [target.clone().addScaledVector(n, 3.2)];
    for (let i = 1; i < 9; i++) {
      const p = target.clone().addScaledVector(n, 3.2 * (1 - i / 9));
      p.addScaledVector(t1, Math.sin(cell * 3.1 + i * 2.7) * 0.22).addScaledVector(t2, Math.cos(cell * 1.7 + i * 1.9) * 0.22);
      pts.push(p);
    }
    pts.push(target.clone().addScaledVector(n, 0.02));
    const out: Array<{ pos: THREE.Vector3; q: THREE.Quaternion; len: number }> = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dir = b.clone().sub(a);
      out.push({ pos: a.clone().add(b).multiplyScalar(0.5), q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize()), len: dir.length() });
    }
    return { out, top: pts[2], target };
  }, [cell]);
  useFrame(() => {
    const t = performance.now() - createdAt;
    if (t > 520) { setAlive(false); return; }
    if (group.current) group.current.visible = Math.floor(t / 45) % 3 !== 2 || t < 100;
    if (light.current) light.current.intensity = Math.max(0, 14 * (1 - t / 520));
  });
  if (!alive) return null;
  return (
    <group>
      <pointLight ref={light} position={segs.top} color="#e8e0ff" intensity={14} distance={5} />
      <group ref={group}>
        {segs.out.map((s, i) => (
          <mesh key={i} position={s.pos} quaternion={s.q}>
            <boxGeometry args={[0.055, 0.055, s.len]} />
            <meshBasicMaterial color={i % 2 ? '#ffffff' : '#d5bcff'} />
          </mesh>
        ))}
      </group>
      <ShockRing cell={cell} maxRadius={LIGHTNING.radius} createdAt={createdAt} duration={520} color="#d5bcff" />
    </group>
  );
}

function ImpactFlash({ cell, radius, createdAt }: { cell: number; radius: number; createdAt: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const pos = useMemo(() => cellPos(cell, 1.01), [cell]);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const t = (performance.now() - createdAt) / 650;
    m.visible = t < 1;
    m.scale.setScalar(0.3 + t * radius * 0.5);
    (m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t);
  });
  return (
    <>
      <mesh ref={ref} position={pos}>
        <sphereGeometry args={[1, 14, 10]} />
        <meshBasicMaterial color="#fff2c0" transparent blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <ShockRing cell={cell} maxRadius={radius * 1.2} createdAt={createdAt} duration={1000} color="#ffb347" />
    </>
  );
}

let eyeTex: THREE.Texture | null = null;
function getEyeTexture(): THREE.Texture {
  if (eyeTex) return eyeTex;
  const src = document.createElement('canvas');
  src.width = 32; src.height = 32;
  drawSpritePreview(src, 'eye', '#b9a0ff');
  const tex = new THREE.CanvasTexture(src);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
  eyeTex = tex;
  return tex;
}

/** Divine Vision: the target is shrouded while a dream eye hovers above them. */
function DreamEffect({ cell, createdAt, duration }: { cell: number; createdAt: number; duration: number }) {
  const eye = useRef<THREE.Sprite>(null);
  const shroud = useRef<THREE.Mesh>(null);
  const pos = useMemo(() => cellPos(cell, 1.004), [cell]);
  const tex = useMemo(() => getEyeTexture(), []);
  useFrame(({ camera }) => {
    const t = (performance.now() - createdAt) / duration;
    if (t >= 1) return;
    const fade = t < 0.15 ? t / 0.15 : t > 0.8 ? (1 - t) / 0.2 : 1;
    if (eye.current) {
      const bob = Math.sin(t * Math.PI * 4) * 0.06;
      eye.current.position.set(pos.x, pos.y + 0.55 + bob, pos.z).normalize().multiplyScalar(PLANET_RADIUS * 1.09);
      const s = 0.5 * fade;
      eye.current.scale.set(s, s, s);
      (eye.current.material as THREE.SpriteMaterial).opacity = fade;
      eye.current.visible = fade > 0.01;
      eye.current.quaternion.copy(camera.quaternion);
    }
    if (shroud.current) {
      shroud.current.position.copy(pos);
      (shroud.current.material as THREE.MeshBasicMaterial).opacity = 0.35 * fade;
    }
  });
  return (
    <group>
      <mesh ref={shroud} position={pos}>
        <sphereGeometry args={[0.42, 14, 10]} />
        <meshBasicMaterial color="#3b1f6e" transparent opacity={0.3} depthWrite={false} />
      </mesh>
      <sprite ref={eye} scale={[0.5, 0.5, 0.5]}>
        <spriteMaterial map={tex} transparent depthTest={false} />
      </sprite>
      <ShockRing cell={cell} maxRadius={1.5} createdAt={createdAt} duration={duration} color="#b9a0ff" />
    </group>
  );
}

function EffectsLayer() {
  const effects = useGame(s => s.effects);
  return (
    <group>
      {effects.map(e => {
        switch (e.type) {
          case 'rain': return <RainEffect key={e.id} cell={e.cellId} radius={e.radius} createdAt={e.createdAt} duration={e.duration} />;
          case 'lightning': return <LightningBolt key={e.id} cell={e.cellId} createdAt={e.createdAt} />;
          case 'nature': return <ShockRing key={e.id} cell={e.cellId} maxRadius={e.radius} createdAt={e.createdAt} duration={e.duration} color="#8bd49a" />;
          case 'life': return <ShockRing key={e.id} cell={e.cellId} maxRadius={e.radius} createdAt={e.createdAt} duration={e.duration} color="#d5bcff" />;
          case 'terraform': return <ShockRing key={e.id} cell={e.cellId} maxRadius={e.radius} createdAt={e.createdAt} duration={e.duration} color="#e6b96b" />;
          case 'impact': return <ImpactFlash key={e.id} cell={e.cellId} radius={e.radius} createdAt={e.createdAt} />;
          case 'dream': return <DreamEffect key={e.id} cell={e.cellId} createdAt={e.createdAt} duration={e.duration} />;
          case 'coronation': return <ShockRing key={e.id} cell={e.cellId} maxRadius={1.8} createdAt={e.createdAt} duration={e.duration} color="#ffe28a" />;
        }
      })}
    </group>
  );
}

function ParticleLayer() {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(P.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, MAX_PARTICLES);
    return g;
  }, []);
  const mat = useMemo(() => new THREE.PointsMaterial({ size: 0.075, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false }), []);
  useFrame((_, dt) => {
    flushBursts();
    stepParticles(Math.min(dt, 0.05));
    (geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geom.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  });
  return <points geometry={geom} material={mat} frustumCulled={false} />;
}

// ============ Input ============
function ClickHandler() {
  const { camera, gl } = useThree();
  const tool = useGame(s => s.tool);
  useEffect(() => { gl.domElement.style.cursor = tool === 'select' ? 'grab' : 'crosshair'; }, [tool, gl]);

  useEffect(() => {
    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const surface = new THREE.Sphere(new THREE.Vector3(), PLANET_RADIUS);
    const point = new THREE.Vector3();
    let down: { x: number; y: number; t: number; dragged: boolean } | null = null;
    const pointers = new Set<number>();

    const pick = (cx: number, cy: number): number | null => {
      if (!planetObj) return null;
      surface.radius = PLANET_RADIUS;
      const rect = canvas.getBoundingClientRect();
      ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.ray.intersectSphere(surface, point);
      if (!hit) return null;
      const { lat, lon } = vec3ToLatLon(hit.x, hit.y, hit.z);
      return latLonToCell(lat, lon, renderSurface);
    };
    const onDown = (e: PointerEvent) => {
      pointers.add(e.pointerId);
      down = pointers.size === 1 && e.button === 0 ? { x: e.clientX, y: e.clientY, t: performance.now(), dragged: false } : null;
      if (e.pointerType === 'mouse') canvas.style.cursor = useGame.getState().tool === 'select' ? 'grabbing' : 'crosshair';
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (e.pointerType === 'mouse') canvas.style.cursor = useGame.getState().tool === 'select' ? 'grab' : 'crosshair';
      const d = down; down = null;
      if (!d || d.dragged || e.button !== 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 500) return; // that was a drag
      const cell = pick(e.clientX, e.clientY);
      if (cell === null) return;
      if (e.pointerType !== 'mouse') hover.cell = cell;
      useGame.getState().usePower(cell);
    };
    const onMove = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX-down.x, e.clientY-down.y)>6) down.dragged = true;
      if (e.pointerType === 'mouse') hover.cell = pick(e.clientX, e.clientY);
    };
    const onLeave = () => { hover.cell = null; };
    const onCancel = (e: PointerEvent) => { pointers.delete(e.pointerId); down = null; };
    // Debug/test hooks: let automated tests aim real mouse events at a given cell
    const w = window as unknown as Record<string, unknown>;
    w.__lgCamera = camera;
    w.__lgScreenOf = (cell: number) => {
      const v = cellPos(cell, 1).clone();
      if (v.clone().normalize().dot(camera.position.clone().sub(v)) <= 0) return null;
      v.project(camera);
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height };
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointercancel', onCancel);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointercancel', onCancel);
    };
  }, [camera, gl]);
  return null;
}

function SimDriver() {
  useFrame((_, dt) => { useGame.getState().advanceSim(dt * 1000); });
  return null;
}

export function GameCanvas() {
  const world = useGame(s => s.world);
  useLayoutEffect(() => { configureSurface(world); }, [world]);
  return (
    <Canvas
      camera={{ position: [0, 4, 12], fov: 45, near: 0.1, far: 1000 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <color attach="background" args={['#05070b']} />
      <Stars radius={120} depth={40} count={1800} factor={3.2} saturation={0} fade speed={0.4} />
      <DynamicLighting />
      <Planet />
      <Atmosphere />
      <SpriteBatch capacity={36000} fill={fillStatic} interval={250} />
      <SpriteBatch capacity={6000} fill={fillDynamic} />
      <ParticleLayer />
      <EffectsLayer />
      <MeteorsLayer />
      <SelectionMarker />
      <HoverMarker />
      <WorldCamera />
      <ClickHandler />
      <SimDriver />
    </Canvas>
  );
}
