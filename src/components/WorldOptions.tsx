import { WORLD_SIZES, DENSITIES, targetCivilizations, type WorldOptions as Options } from '../game/scale';
import { C } from './common';

export function WorldOptions({ value, onChange }: { value: Options; onChange: (v: Options) => void }) {
  const size = WORLD_SIZES[value.size];
  const style = { background: C.panel, color: C.text, border: `1px solid ${C.border}` };
  return <fieldset className="text-left flex flex-col gap-2 mb-3">
    <legend className="sr-only">World generation</legend>
    <div className="grid grid-cols-2 gap-3">
      <label className="flex flex-col gap-1 text-xs" style={{ color: C.dim }}>
        World size
        <select aria-label="World size" className="rounded px-2 py-2" style={style} value={value.size}
          onChange={e => onChange({ ...value, size: e.target.value as Options['size'] })}>
          {Object.entries(WORLD_SIZES).map(([key,s]) => <option key={key} value={key}>{s.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs" style={{ color: C.dim }}>
        Civilization density
        <select aria-label="Civilization density" className="rounded px-2 py-2" style={style} value={value.density}
          onChange={e => onChange({ ...value, density: e.target.value as Options['density'] })}>
          {Object.entries(DENSITIES).map(([key,d]) => <option key={key} value={key}>{d.label}</option>)}
        </select>
      </label>
    </div>
    <p className="text-[11px] leading-relaxed" style={{ color: C.dim }}>
      {(size.width * size.height).toLocaleString()} terrain regions. Around {targetCivilizations(value)} independent peoples,
      where the land can support them. Existing saves stay unchanged.
    </p>
  </fieldset>;
}