// Small shared UI building blocks.

import { useEffect, useRef } from 'react';
import { drawSpritePreview } from '../rendering/atlas';
import { iconCanvas } from '../rendering/icons';
import type { Activity, Living, SpeciesId } from '../game/types';
import { AGE_UNIT_DAYS } from '../game/config';

export const C = {
  bg: '#090B10', panel: '#11151D', border: '#252C38', text: '#E8EDF5', dim: '#8D98AA',
  nature: '#8BD49A', divine: '#D5BCFF', warn: '#E6B96B', danger: '#e67979', raised: '#1a2030',
};

export const TASK_LABEL: Record<Activity, string> = {
  idle: 'idle', wander: 'wandering', forage: 'foraging', chop: 'chopping wood', farm: 'farming', build: 'building',
  travel: 'travelling', rest: 'resting', social: 'socializing', reproduce: 'starting a family', mine: 'mining',
  hunt: 'hunting', patrol: 'on guard', march: 'marching', fight: 'fighting', raid: 'raiding', retreat: 'retreating',
  graze: 'grazing', flee: 'fleeing', roam: 'roaming', guard: 'guarding', panic: 'running in panic', dead: 'dead',
};

export const SPRITE_FOR: Record<SpeciesId, string> = { human: 'human', deer: 'deer', wolf: 'wolf', rabbit: 'rabbit', golem: 'golem' };

export function SpritePreview({ sprite, size = 48, tint = '#8BD49A' }: { sprite: string; size?: number; tint?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) drawSpritePreview(ref.current, sprite, tint); }, [sprite, tint]);
  return (
    <canvas
      ref={ref} width={size} height={size}
      style={{ width: size, height: size, imageRendering: 'pixelated', background: '#0c1018', borderRadius: 6, border: `1px solid ${C.border}` }}
    />
  );
}

/** A pixel-art tool icon. States are expressed with real pixel colours, never CSS blur. */
export function PixelIcon({ name, size = 32, disabled, selected }: { name: string; size?: number; disabled?: boolean; selected?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const src = iconCanvas(name, disabled ? 'disabled' : 'default');
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0, c.width, c.height);
  }, [name, disabled]);
  return (
    <canvas
      ref={ref} width={32} height={32}
      style={{
        width: size, height: size, imageRendering: 'pixelated', display: 'block',
        filter: selected ? 'drop-shadow(0 0 3px rgba(213,188,255,0.85))' : undefined,
        opacity: disabled ? 0.55 : 1,
      }}
    />
  );
}

/** Small pixel-art crown, used wherever a ruler is named in the interface. */
export function CrownIcon({ size = 14 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) drawSpritePreview(ref.current, 'crown', '#ffd24a'); }, []);
  return <canvas ref={ref} width={16} height={16} style={{ width: size, height: size, imageRendering: 'pixelated', display: 'inline-block', verticalAlign: '-2px' }} />;
}

export function Bar({ value, color, label }: { value: number; color: string; label: string }) {
  return (
    <div className="flex items-center gap-2" style={{ fontSize: 10 }}>
      <span style={{ color: C.dim, width: 46 }}>{label}</span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: C.border }}>
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
      </div>
      <span className="font-mono" style={{ color: C.dim, width: 28, textAlign: 'right' }}>{Math.round(value * 100)}</span>
    </div>
  );
}

export function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'good' ? C.nature : tone === 'warn' ? C.warn : tone === 'bad' ? C.danger : C.text;
  return (
    <div className="flex justify-between items-center py-1" style={{ borderBottom: `1px solid ${C.raised}` }}>
      <span style={{ color: C.dim }}>{label}</span>
      <span className="font-mono font-medium" style={{ color }}>{value}</span>
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="uppercase tracking-wider mt-3 mb-1" style={{ color: C.dim, fontSize: 9 }}>{children}</div>;
}

export function Chip({ children, color = C.dim }: { children: React.ReactNode; color?: string }) {
  return <span className="px-1.5 py-0.5 rounded" style={{ background: C.raised, color, fontSize: 10 }}>{children}</span>;
}

export function Btn({ children, onClick, disabled, primary, title, className = '' }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; primary?: boolean; title?: string; className?: string;
}) {
  return (
    <button
      onClick={onClick} disabled={disabled} title={title}
      className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-40 ${className}`}
      style={primary
        ? { background: C.divine, color: C.bg }
        : { background: C.raised, border: `1px solid ${C.border}`, color: C.text }}
    >
      {children}
    </button>
  );
}

export function fmtAge(e: Living): string {
  return e.species === 'human' ? `${Math.floor(e.age / AGE_UNIT_DAYS)} yrs` : `${Math.floor(e.age)} days`;
}
