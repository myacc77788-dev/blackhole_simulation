import type { ReactNode } from 'react';

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  unit = '',
  digits = 2,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  digits?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block select-none">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/55">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-amber-200/90">
          {value.toFixed(digits)}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="bh-range w-full"
      />
    </label>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      title={hint}
      className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition hover:border-white/20 hover:bg-white/[0.07]"
    >
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/70">{label}</span>
      <span
        className={`relative h-4 w-8 rounded-full transition-colors ${
          checked ? 'bg-amber-400/80' : 'bg-white/15'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${
            checked ? 'left-4.5 translate-x-0' : 'left-0.5'
          }`}
          style={{ left: checked ? '1.125rem' : '0.125rem' }}
        />
      </span>
    </button>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.25em] text-amber-300/70">{title}</span>
        <span className="h-px flex-1 bg-gradient-to-r from-amber-300/30 to-transparent" />
      </div>
      {children}
    </div>
  );
}
