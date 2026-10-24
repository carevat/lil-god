import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as Controls } from 'three-stdlib';
import * as THREE from 'three';
import { useGame } from '../game/store';
import { gridFor } from '../game/grid';

export function overviewDistance(radius: number, aspect: number, fov = 45): number {
  const vertical = fov * Math.PI / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  return radius * 1.35 / Math.sin(Math.min(vertical, horizontal) / 2);
}

/** Animate along an arc outside the sphere, never a straight line through its interior. */
export function WorldCamera() {
  const { camera, size } = useThree();
  const world = useGame(s => s.world);
  const request = useGame(s => s.cameraRequest);
  const controls = useRef<Controls>(null);
  const radius = world?.radius ?? 5;
  const distance = overviewDistance(radius, size.width / size.height);
  const travel = useRef<{ from: THREE.Vector3; arc: THREE.Quaternion; d0: number; d1: number; time: number } | null>(null);
  const temp = useRef(new THREE.Quaternion());
  const overview = useRef(true);
  const lastFit = useRef(distance);

  useEffect(() => {
    travel.current = null; overview.current = true;
    const start = world ? Object.values(world.settlements)[0]?.cellId : undefined;
    const direction = start !== undefined && world
      ? new THREE.Vector3(...gridFor(world).unit(start))
      : new THREE.Vector3(0, .3, 1).normalize();
    camera.position.copy(direction).multiplyScalar(distance);
    camera.lookAt(0,0,0);
    controls.current?.target.set(0,0,0);
    controls.current?.update();
  }, [world, camera]);

  useEffect(() => {
    if (lastFit.current !== distance && overview.current) {
      travel.current = { from: camera.position.clone().normalize(), arc: new THREE.Quaternion(), d0: camera.position.length(), d1: distance, time: 0 };
    }
    lastFit.current = distance;
  }, [distance, camera]);

  useEffect(() => {
    if (!world || !request) return;
    let cell = request.cellId;
    const e = request.entityId ? world.citizens[request.entityId] ?? world.creatures[request.entityId] ?? world.buildings[request.entityId] : undefined;
    if (e) cell = e.cellId;
    overview.current = request.mode === 'overview';
    const from = camera.position.clone().normalize();
    const to = overview.current || cell === null || !world.cells[cell] ? from.clone() : new THREE.Vector3(...gridFor(world).unit(cell));
    if (!overview.current && e && 'targetCellId' in e && e.targetCellId !== null) {
      to.lerp(new THREE.Vector3(...gridFor(world).unit(e.targetCellId)), e.moveProgress).normalize();
    }
    travel.current = {
      from, arc: new THREE.Quaternion().setFromUnitVectors(from,to), d0: camera.position.length(),
      d1: overview.current ? distance : radius + 3.2, time: 0,
    };
  }, [request, world, camera, distance, radius]);

  useFrame((_, dt) => {
    const c = controls.current;
    const flight = travel.current;
    if (flight) {
      flight.time = Math.min(1, flight.time + Math.min(dt,.1) / .9);
      const t = flight.time * flight.time * (3 - 2 * flight.time);
      temp.current.identity().slerp(flight.arc,t);
      camera.position.copy(flight.from).applyQuaternion(temp.current)
        .multiplyScalar(Math.max(radius + .85, THREE.MathUtils.lerp(flight.d0, flight.d1, t)));
      camera.lookAt(0,0,0); c?.update();
      if (flight.time === 1) travel.current = null;
    }
    if (c) c.rotateSpeed = THREE.MathUtils.clamp((camera.position.length() - radius) / (radius * 2), .08, .7);
  }, -.5);

  return <OrbitControls ref={controls} makeDefault enablePan={false} enableDamping dampingFactor={.08}
    minDistance={radius + .85} maxDistance={Math.max(distance * 1.3, radius * 5)} zoomSpeed={.7}
    autoRotate={!world} autoRotateSpeed={.35}
    onStart={() => { travel.current = null; overview.current = false; }} />;
}