// Instanced billboard sprites: one draw call for thousands of trees, buildings and creatures.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getAtlas, spriteUV, SPRITES } from './atlas';
import { sunDir, spriteScale } from './shared';
import { useGame } from '../game/store';

export interface BatchWriter {
  n: number;
  add(key: string, x: number, y: number, z: number, scale?: number, tint?: [number, number, number], alpha?: number, flip?: number): void;
}
export interface BatchCtx { camRight: THREE.Vector3; camUp: THREE.Vector3; camDist: number; camDirection: THREE.Vector3; time: number }

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iUv;
attribute vec4 iMisc;
attribute vec3 iTint;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uScale;
uniform vec3 uSun;
varying vec2 vUv;
varying vec3 vTint;
varying float vAlpha;
varying float vLit;
void main() {
  float size = iMisc.x * uScale;
  vec3 world = iPos + uRight * (position.x * size) + uUp * (position.y * size);
  float fx = iMisc.y > 0.0 ? position.x + 0.5 : 0.5 - position.x;
  vUv = vec2(iUv.x + fx * iUv.z, iUv.y + position.y * iUv.w);
  vTint = iTint;
  vAlpha = iMisc.z;
  vLit = dot(normalize(iPos), uSun);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uDust;
varying vec2 vUv;
varying vec3 vTint;
varying float vAlpha;
varying float vLit;
void main() {
  vec4 t = texture2D(uMap, vUv);
  if (t.a < 0.5) discard;
  if (vAlpha < 0.999) {
    float n = fract(sin(dot(floor(gl_FragCoord.xy / 2.0), vec2(12.9898, 78.233))) * 43758.5453);
    if (n > vAlpha) discard;
  }
  vec3 c = t.rgb;
  float k1 = step(0.94, c.r) * step(0.94, c.b) * step(c.g, 0.06);
  float k2 = step(0.74, c.r) * step(c.r, 0.83) * step(0.74, c.b) * step(c.b, 0.83) * step(c.g, 0.06);
  c = mix(c, vTint, k1);
  c = mix(c, vTint * 0.65, k2);
  float lit = smoothstep(-0.25, 0.35, vLit);
  float light = mix(0.42, 1.0, lit) * (1.0 - 0.3 * uDust);
  float win = step(abs(c.r - 1.0) + abs(c.g - 0.886) + abs(c.b - 0.541), 0.09);
  vec3 outc = mix(c * light, vec3(1.0, 0.85, 0.45), win * (1.0 - lit));
  gl_FragColor = vec4(outc, 1.0);
}`;

interface Props {
  capacity: number;
  fill: (w: BatchWriter, ctx: BatchCtx) => void;
  /** Minimum milliseconds between refills (0 = every frame). */
  interval?: number;
}

export function SpriteBatch({ capacity, fill, interval = 0 }: Props) {
  const camera = useThree(s => s.camera);
  const last = useRef(-1e9);
  const ctxRef = useRef<BatchCtx>({ camRight: new THREE.Vector3(), camUp: new THREE.Vector3(), camDist: 12, camDirection: new THREE.Vector3(), time: 0 });

  const built = useMemo(() => {
    const atlas = getAtlas();
    const geom = new THREE.InstancedBufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    geom.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (n: number) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const iPos = mk(3), iUv = mk(4), iMisc = mk(4), iTint = mk(3);
    geom.setAttribute('iPos', iPos); geom.setAttribute('iUv', iUv); geom.setAttribute('iMisc', iMisc); geom.setAttribute('iTint', iTint);
    geom.instanceCount = 0;
    const tex = new THREE.CanvasTexture(atlas.canvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    const uniforms = {
      uMap: { value: tex }, uRight: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) },
      uScale: { value: 1 }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uDust: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.frustumCulled = false;
    const uvCache = new Map<string, [number, number, number, number]>();
    const writer: BatchWriter = {
      n: 0,
      add(key, x, y, z, scale = 1, tint = [1, 1, 1], alpha = 1, flip = 1) {
        if (this.n >= capacity) return;
        let uv = uvCache.get(key);
        if (!uv) { uv = spriteUV(atlas, key); uvCache.set(key, uv); }
        const base = key.endsWith('_b') ? key.slice(0, -2) : key;
        const px = SPRITES[base]?.px ?? 0.02;
        const i = this.n++;
        iPos.array[i * 3] = x; iPos.array[i * 3 + 1] = y; iPos.array[i * 3 + 2] = z;
        iUv.array[i * 4] = uv[0]; iUv.array[i * 4 + 1] = uv[1]; iUv.array[i * 4 + 2] = uv[2]; iUv.array[i * 4 + 3] = uv[3];
        iMisc.array[i * 4] = 16 * px * scale; iMisc.array[i * 4 + 1] = flip; iMisc.array[i * 4 + 2] = alpha; iMisc.array[i * 4 + 3] = 0;
        iTint.array[i * 3] = tint[0]; iTint.array[i * 3 + 1] = tint[1]; iTint.array[i * 3 + 2] = tint[2];
      },
    };
    return { mesh, geom, mat, tex, uniforms, writer, attrs: [iPos, iUv, iMisc, iTint] };
  }, [capacity]);

  useEffect(() => () => { built.geom.dispose(); built.mat.dispose(); built.tex.dispose(); }, [built]);

  useFrame(state => {
    camera.updateMatrixWorld();
    const m = camera.matrixWorld.elements;
    const c = ctxRef.current;
    c.camRight.set(m[0], m[1], m[2]); c.camUp.set(m[4], m[5], m[6]);
    c.camDist = camera.position.length();
    c.camDirection.copy(camera.position).normalize();
    c.time = state.clock.elapsedTime;
    const u = built.uniforms;
    u.uRight.value.copy(c.camRight); u.uUp.value.copy(c.camUp);
    u.uScale.value = spriteScale(c.camDist);
    u.uSun.value.copy(sunDir);
    u.uDust.value = useGame.getState().world?.dust ?? 0;
    const t = state.clock.elapsedTime * 1000;
    if (t - last.current < interval) return;
    last.current = t;
    built.writer.n = 0;
    fill(built.writer, c);
    for (const a of built.attrs) a.needsUpdate = true;
    built.geom.instanceCount = built.writer.n;
  });

  return <primitive object={built.mesh} />;
}
