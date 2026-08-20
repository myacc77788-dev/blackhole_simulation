import { useEffect, useRef, useState } from 'react';
import { BlackHoleRenderer, DEFAULT_PARAMS, type BHParams } from './blackhole/renderer';
import { Slider, Toggle, Section } from './components/ui';

type Preset = {
  name: string;
  desc: string;
  view: [number, number, number]; // dist, yaw, pitch
  patch: Partial<BHParams>;
};

const PRESETS: Preset[] = [
  {
    name: 'Gargantua',
    desc: 'Thin bright disk, near edge-on — the cinematic view',
    view: [16, 0.6, 0.09],
    patch: { diskInner: 3, diskOuter: 22, diskThick: 0.22, diskTemp: 8200, diskBright: 1.0, jet: 0, doppler: 0.35, diskNoise: 0.7 },
  },
  {
    name: 'M87*',
    desc: 'Face-on flow, dominant photon ring and shadow',
    view: [22, 0.9, 1.05],
    patch: { diskInner: 3.2, diskOuter: 16, diskThick: 0.55, diskTemp: 5200, diskBright: 1.1, jet: 0.35, doppler: 1, diskNoise: 1 },
  },
  {
    name: 'Edge-on',
    desc: 'Zero inclination — full Einstein ring of the far side',
    view: [14, 0.2, 0.005],
    patch: { diskInner: 3, diskOuter: 26, diskThick: 0.16, diskTemp: 11000, diskBright: 0.9, jet: 0, doppler: 1, diskNoise: 0.8 },
  },
  {
    name: 'Quasar',
    desc: 'Hot inner disk, relativistic jets along the spin axis',
    view: [26, 1.4, 0.35],
    patch: { diskInner: 3, diskOuter: 30, diskThick: 0.35, diskTemp: 16000, diskBright: 1.3, jet: 0.9, doppler: 1, diskNoise: 1 },
  },
  {
    name: 'Naked hole',
    desc: 'No accretion — pure gravitational lensing of the starfield',
    view: [11, 0.5, 0.25],
    patch: { diskBright: 0, jet: 0, stars: 1.6, nebula: 1.4 },
  },
];

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<BlackHoleRenderer | null>(null);
  const [params, setParams] = useState<BHParams>({ ...DEFAULT_PARAMS });
  const [fps, setFps] = useState(0);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!canvasRef.current) return;
    let r: BlackHoleRenderer;
    try {
      r = new BlackHoleRenderer(canvasRef.current, params);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    rendererRef.current = r;
    r.onFps = (f) => setFps(f);
    r.setView(...PRESETS[0].view);
    r.start();
    const onResize = () => r.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      r.dispose();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.params = params;
  }, [params]);

  const set = <K extends keyof BHParams>(k: K, v: BHParams[K]) => setParams((p) => ({ ...p, [k]: v }));

  const applyPreset = (i: number) => {
    const p = PRESETS[i];
    setActive(i);
    setParams((prev) => ({ ...DEFAULT_PARAMS, ...{ exposure: prev.exposure, bloom: prev.bloom, renderScale: prev.renderScale, steps: prev.steps }, ...p.patch }));
    rendererRef.current?.setView(...p.view);
  };

  const shoot = () => {
    const r = rendererRef.current;
    if (!r) return;
    const a = document.createElement('a');
    a.href = r.screenshot();
    a.download = 'black-hole.png';
    a.click();
  };

  // Physics readouts (rs = 1 units, geometric)
  const rs = 1;
  const photonSphere = 1.5 * rs;
  const shadowRadius = 2.598 * rs; // sqrt(27)/2 * rs, apparent impact parameter

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-white">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />

      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <div className="max-w-md rounded-xl border border-red-500/30 bg-red-950/40 p-6 text-center backdrop-blur">
            <h2 className="mb-2 text-lg font-semibold">WebGL2 required</h2>
            <p className="text-sm text-white/70">{error}</p>
          </div>
        </div>
      )}

      {/* Title */}
      <div className="pointer-events-none absolute left-6 top-6 max-w-sm">
        <div className="text-[10px] font-semibold uppercase tracking-[0.4em] text-amber-300/70">
          Schwarzschild metric · real-time
        </div>
        <h1 className="mt-1 bg-gradient-to-b from-white to-white/50 bg-clip-text text-3xl font-light tracking-tight text-transparent md:text-4xl">
          Black&nbsp;Hole Simulator
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-white/45">
          Null geodesics integrated per pixel through curved spacetime, with a volumetric accretion
          disk rendered with Doppler beaming, gravitational redshift and blackbody emission.
        </p>
      </div>

      {/* Readouts */}
      <div className="pointer-events-none absolute bottom-6 left-6 space-y-1 font-mono text-[11px] text-white/45">
        <div>
          r<sub>s</sub> = {rs.toFixed(2)} · photon sphere = {photonSphere.toFixed(2)} r<sub>s</sub> · shadow ={' '}
          {shadowRadius.toFixed(3)} r<sub>s</sub>
        </div>
        <div>
          ISCO = 3.00 r<sub>s</sub> · disk {params.diskInner.toFixed(1)}–{params.diskOuter.toFixed(0)} r
          <sub>s</sub> · T<sub>peak</sub> = {Math.round(params.diskTemp).toLocaleString()} K
        </div>
        <div className="text-white/30">
          {fps.toFixed(0)} fps · {params.steps} integration steps/ray · drag to orbit, scroll to zoom
        </div>
      </div>

      {/* Presets */}
      <div className="absolute bottom-6 right-6 flex flex-wrap justify-end gap-2 md:right-[22rem]">
        {PRESETS.map((p, i) => (
          <button
            key={p.name}
            onClick={() => applyPreset(i)}
            title={p.desc}
            className={`rounded-full border px-3.5 py-1.5 text-[11px] uppercase tracking-[0.12em] backdrop-blur transition ${
              active === i
                ? 'border-amber-300/60 bg-amber-300/15 text-amber-100'
                : 'border-white/10 bg-black/40 text-white/60 hover:border-white/25 hover:text-white'
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* Control panel */}
      <div
        className={`absolute right-0 top-0 h-full w-[20rem] transform border-l border-white/10 bg-black/55 backdrop-blur-xl transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-white/70">Controls</span>
            <div className="flex gap-2">
              <button
                onClick={shoot}
                className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase tracking-widest text-white/60 transition hover:border-white/40 hover:text-white"
              >
                Save
              </button>
              <button
                onClick={() => setOpen(false)}
                className="rounded border border-white/15 px-2 py-1 text-[10px] uppercase tracking-widest text-white/60 transition hover:border-white/40 hover:text-white"
              >
                Hide
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
            <Section title="Accretion disk">
              <Slider label="Brightness" value={params.diskBright} min={0} max={3} onChange={(v) => set('diskBright', v)} />
              <Slider
                label="Peak temperature"
                value={params.diskTemp}
                min={2000}
                max={22000}
                step={100}
                unit=" K"
                digits={0}
                onChange={(v) => set('diskTemp', v)}
              />
              <Slider label="Inner radius" value={params.diskInner} min={3.0} max={8} step={0.05} unit=" rs" onChange={(v) => set('diskInner', v)} />
              <Slider label="Outer radius" value={params.diskOuter} min={6} max={40} step={0.5} unit=" rs" digits={1} onChange={(v) => set('diskOuter', v)} />
              <Slider label="Scale height" value={params.diskThick} min={0.04} max={1.2} onChange={(v) => set('diskThick', v)} />
              <Slider label="Turbulence" value={params.diskNoise} min={0} max={1} onChange={(v) => set('diskNoise', v)} />
              <Slider label="Orbital speed" value={params.spin} min={0} max={3} onChange={(v) => set('spin', v)} />
              <Slider label="Polar jets" value={params.jet} min={0} max={1.5} onChange={(v) => set('jet', v)} />
            </Section>

            <Section title="Relativity">
              <Slider
                label="Spacetime curvature"
                value={params.lensing}
                min={0}
                max={1}
                onChange={(v) => set('lensing', v)}
              />
              <Slider
                label="Doppler / redshift"
                value={params.doppler}
                min={0}
                max={1}
                onChange={(v) => set('doppler', v)}
              />
              <p className="text-[11px] leading-relaxed text-white/35">
                Curvature 0 disables geodesic bending (flat-space control). Doppler blends in
                relativistic beaming, aberration-driven asymmetry and gravitational redshift of the
                orbiting plasma.
              </p>
            </Section>

            <Section title="Sky">
              <Slider label="Star brightness" value={params.stars} min={0} max={3} onChange={(v) => set('stars', v)} />
              <Slider label="Nebulae / Milky Way" value={params.nebula} min={0} max={3} onChange={(v) => set('nebula', v)} />
            </Section>

            <Section title="Camera & render">
              <Slider label="Field of view" value={params.fov} min={20} max={100} step={1} unit="°" digits={0} onChange={(v) => set('fov', v)} />
              <Slider label="Exposure" value={params.exposure} min={0.1} max={4} onChange={(v) => set('exposure', v)} />
              <Slider label="Bloom" value={params.bloom} min={0} max={2} onChange={(v) => set('bloom', v)} />
              <Slider
                label="Integration steps"
                value={params.steps}
                min={80}
                max={600}
                step={10}
                digits={0}
                onChange={(v) => set('steps', v)}
              />
              <Slider
                label="Resolution scale"
                value={params.renderScale}
                min={0.4}
                max={1.25}
                step={0.05}
                onChange={(v) => set('renderScale', v)}
              />
              <Toggle label="Auto orbit" checked={params.autoOrbit} onChange={(v) => set('autoOrbit', v)} />
              <Toggle label="Freeze time" checked={params.paused} onChange={(v) => set('paused', v)} />
            </Section>
          </div>
        </div>
      </div>

      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="absolute right-6 top-6 rounded-full border border-white/15 bg-black/50 px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-white/70 backdrop-blur transition hover:border-white/40 hover:text-white"
        >
          Controls
        </button>
      )}
    </div>
  );
}
