/**
 * Headless checks for the gravity, climbing, tearing and obstacle code, plus a
 * timing sweep over vessel sizes.
 */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'
import { PRESET_BY_ID } from '../src/sim/presets'

function build(presetId: string, maxMotes = 45000) {
  const p = PRESET_BY_ID[presetId]
  const c = new Colony(
    { ...DEFAULT_PARAMS, grid: p.grid ?? 96, maxMotes },
    { ...DEFAULT_ENV, ...(p.env ?? {}) },
  )
  const n = c.n
  for (const s of p.solids ?? [])
    c.addSolid(s.kindId, s.material ?? 'wood', s.at[0] * n, s.at[1] * n, s.at[2] * n, s.scale ?? 1, s.rotated ?? false)
  for (const f of p.foods) c.addFood(f.defId, f.at[0] * n, f.at[1] * n, f.at[2] * n, f.massMg)
  for (const i of p.inocula) c.inoculate(i.at[0] * n, i.at[1] * n, i.at[2] * n, i.motes ?? 240, 2.4)
  return c
}

function run(presetId: string, hours: number, maxMotes = 45000) {
  const c = build(presetId, maxMotes)
  const steps = Math.round((hours * 60) / FIXED_STEP_MIN)
  const t0 = performance.now()
  for (let s = 0; s < steps; s++) c.step(FIXED_STEP_MIN)
  const ms = performance.now() - t0
  const st = c.buildStats()

  let maxY = 0, insideSolid = 0, bad = 0, sumY = 0, alive = 0
  for (let i = 0; i < c.highWater; i++) {
    if (c.state[i] === 0) continue
    alive++
    sumY += c.py[i]
    if (c.py[i] > maxY) maxY = c.py[i]
    if (c.isSolid(c.px[i], c.py[i], c.pz[i])) insideSolid++
    if (!isFinite(c.px[i] + c.py[i] + c.pz[i] + c.biomass[i])) bad++
  }
  for (const f of [c.carb, c.prot, c.trail]) {
    let leak = 0
    for (const i of (c as unknown as { obstacles?: { solid: Int32Array } }).obstacles?.solid ?? [])
      if (f.data[i] > 1e-9) leak++
    if (leak > 0) console.log(`      !! ${leak} solid voxels hold substrate`)
    for (let i = 0; i < f.data.length; i++) if (!isFinite(f.data[i])) bad++
  }

  console.log(
    `[${presetId.padEnd(10)}] ${(ms / steps).toFixed(2)} ms/step | biomass ${st.biomassMg
      .toFixed(2)
      .padStart(6)}mg motes ${String(st.motes).padStart(5)} dorm ${String(st.dormant).padStart(4)} | ` +
      `y mean ${(sumY / Math.max(1, alive)).toFixed(1)} max ${maxY.toFixed(1)} | grip ${st.adhered} air ${st.airborne} tears ${st.tears} | ` +
      `insideSolid ${insideSolid} bad ${bad} | food ${st.foodRemainingMg.toFixed(0)}mg | tubes ${st.veinVolumeMm3}mm3 slime ${st.networkVoxels}`,
  )
  for (const d of st.diagnostics.filter((x) => x.level !== 'info')) console.log(`      [${d.level}] ${d.text}`)
  return st
}

console.log('=== mechanics ===')
run('tower', 24)
run('canyon', 10)
run('maze', 10, 60000)
run('shelves', 10)
run('long-haul', 14, 60000)
run('gel', 10)
run('classic', 10)

console.log()
console.log('=== timing sweep (empty vessel, 1 h, colony still small) ===')
for (const grid of [64, 96, 128, 160]) {
  const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 60000 }, { ...DEFAULT_ENV })
  c.addFood('oat-flake', grid * 0.5, 4, grid * 0.5)
  c.inoculate(grid * 0.5, 4, grid * 0.5, 300, 2.4)
  const steps = 240
  const t0 = performance.now()
  for (let s = 0; s < steps; s++) c.step(FIXED_STEP_MIN)
  const ms = performance.now() - t0
  console.log(
    `grid ${String(grid).padStart(3)}mm (${((grid ** 3) / 1e6).toFixed(2)}M voxels): ${(ms / steps).toFixed(
      2,
    )} ms/step, motes ${c.motes}`,
  )
}
