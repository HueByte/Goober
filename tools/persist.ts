/** Round-trip check for the scene snapshot. */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'
import { PRESET_BY_ID } from '../src/sim/presets'
import { foodMassMg } from '../src/sim/foods'

const p = PRESET_BY_ID['maze']
const a = new Colony({ ...DEFAULT_PARAMS, grid: p.grid ?? 96 }, { ...DEFAULT_ENV, ...(p.env ?? {}) })
const n = a.n
for (const s of p.solids ?? [])
  a.addSolid(s.kindId, s.material ?? 'wood', s.at[0] * n, s.at[1] * n, s.at[2] * n, s.scale ?? 1, s.rotated ?? false, undefined, s.climbable ?? true)
for (const f of p.foods) a.addFood(f.defId, f.at[0] * n, f.at[1] * n, f.at[2] * n, f.massMg)
for (const i of p.inocula) a.inoculate(i.at[0] * n, i.at[1] * n, i.at[2] * n, i.motes ?? 240, 2.4)
for (let s = 0; s < (8 * 60) / FIXED_STEP_MIN; s++) a.step(FIXED_STEP_MIN)

const before = a.buildStats()
const snap = a.snapshot()

const b = new Colony({ ...DEFAULT_PARAMS }, { ...DEFAULT_ENV })
b.restore(snap)
const after = b.buildStats()

const line = (k: string, x: number | string, y: number | string) =>
  console.log(`  ${k.padEnd(18)} ${String(x).padStart(12)} -> ${String(y).padStart(12)}${x === y ? '' : '   *'}`)

console.log('snapshot round trip (maze, 8 h):')
line('grid', a.n, b.n)
line('time (min)', before.timeMin.toFixed(1), after.timeMin.toFixed(1))
line('motes', before.motes, after.motes)
line('dormant', before.dormant, after.dormant)
line('biomass mg', before.biomassMg.toFixed(3), after.biomassMg.toFixed(3))
line('solids', a.solids.length, b.solids.length)
line('foods', a.foods.length, b.foods.length)
line('food mg', a.foods.reduce((s, f) => s + foodMassMg(f), 0).toFixed(1), b.foods.reduce((s, f) => s + foodMassMg(f), 0).toFixed(1))
line('haem pool', a.tracePool.heme.toFixed(3), b.tracePool.heme.toFixed(3))
line('divisions', before.divisions, after.divisions)
line('sheer walls', a.solids.filter((s) => !s.climbable).length, b.solids.filter((s) => !s.climbable).length)

// The restored colony must keep running without exploding.
for (let s = 0; s < (2 * 60) / FIXED_STEP_MIN; s++) b.step(FIXED_STEP_MIN)
const later = b.buildStats()
let bad = 0
for (let i = 0; i < b.highWater; i++) {
  if (b.state[i] === 0) continue
  if (!isFinite(b.px[i] + b.py[i] + b.pz[i] + b.biomass[i])) bad++
  if (b.isSolid(b.px[i], b.py[i], b.pz[i])) bad++
}
console.log(
  `  after 2 more hours: motes ${later.motes}, biomass ${later.biomassMg.toFixed(3)} mg, tubes ${later.veinVolumeMm3} mm3, bad ${bad}`,
)
