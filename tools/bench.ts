/** Where the frame time actually goes. */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'
import { PRESET_BY_ID } from '../src/sim/presets'

function build(presetId: string, grid: number) {
  const p = PRESET_BY_ID[presetId]
  const c = new Colony(
    { ...DEFAULT_PARAMS, grid, maxMotes: 60000 },
    { ...DEFAULT_ENV, ...(p.env ?? {}) },
  )
  const n = c.n
  for (const s of p.solids ?? [])
    c.addSolid(s.kindId, s.material ?? 'wood', s.at[0] * n, s.at[1] * n, s.at[2] * n, s.scale ?? 1, s.rotated ?? false, undefined, s.climbable ?? true)
  for (const f of p.foods) c.addFood(f.defId, f.at[0] * n, f.at[1] * n, f.at[2] * n, f.massMg)
  for (const i of p.inocula) c.inoculate(i.at[0] * n, i.at[1] * n, i.at[2] * n, i.motes ?? 240, 2.4)
  return c
}

/** What the renderer does every few frames: a full sweep of a field. */
function sweep(data: Float32Array, n: number, threshold: number) {
  let k = 0
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      const row = n * (y + n * z)
      for (let x = 0; x < n; x++) if (data[row + x] > threshold) k++
    }
  }
  return k
}

for (const grid of [96, 128]) {
  const c = build('classic', grid)
  for (const hours of [2, 12, 30]) {
    while (c.timeMin < hours * 60) c.step(FIXED_STEP_MIN)

    let t0 = performance.now()
    for (let i = 0; i < 40; i++) c.step(FIXED_STEP_MIN)
    const stepMs = (performance.now() - t0) / 40

    t0 = performance.now()
    for (let i = 0; i < 10; i++) c.buildStats()
    const statsMs = (performance.now() - t0) / 10

    t0 = performance.now()
    for (let i = 0; i < 10; i++) {
      sweep(c.vein.data, c.n, 4)
      sweep(c.trail.data, c.n, 5)
    }
    const sweepMs = (performance.now() - t0) / 10

    const st = c.buildStats()
    console.log(
      `grid ${grid} t=${String(hours).padStart(2)}h motes=${String(st.motes).padStart(6)} | step ${stepMs
        .toFixed(2)
        .padStart(5)}ms | buildStats ${statsMs.toFixed(2).padStart(5)}ms | render sweeps ${sweepMs
        .toFixed(2)
        .padStart(5)}ms | at 20 min/s that is ${(1.33 * stepMs).toFixed(1)}ms of sim per frame`,
    )
  }
  console.log()
}
