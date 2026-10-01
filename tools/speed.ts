/** How fast should the front actually advance? */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'
import type { SimParams } from '../src/sim/types'

function run(over: Partial<SimParams>, label: string) {
  const grid = 96
  const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 40000, ...over }, { ...DEFAULT_ENV })
  c.addFood('bacteria-lawn', grid / 2, 4, grid / 2, 260)
  c.inoculate(grid / 2, 4, grid / 2, 260, 2.4)
  for (let s = 0; s < (16 * 60) / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
  let n = 0
  let dist = 0
  let sat = 0
  let bio = 0
  for (let i = 0; i < c.highWater; i++) {
    if (c.state[i] !== 1) continue
    n++
    dist += Math.hypot(c.px[i] - grid / 2, c.pz[i] - grid / 2)
    sat += c.satiety[i]
    bio += c.bio.nearest(c.px[i], c.py[i], c.pz[i])
  }
  const st = c.buildStats()
  console.log(
    `${label.padEnd(16)} motes ${String(st.motes).padStart(5)} | biomass ${st.biomassMg
      .toFixed(2)
      .padStart(6)}mg | sat ${(sat / Math.max(1, n)).toFixed(2)} | spread ${(dist / Math.max(1, n))
      .toFixed(1)
      .padStart(5)}mm | body@mote ${(bio / Math.max(1, n)).toFixed(0).padStart(4)} | colonised ${(
      c.foods[0]?.colonization ?? 0
    ).toFixed(2)} | eaten ${(260 - (c.foods[0] ? 260 * 0 + 0 : 0)).toFixed(0)}`,
  )
}

for (const [sp, sd] of [
  [0.34, 2.2],
  [0.16, 1.8],
  [0.08, 1.6],
  [0.04, 1.4],
  [0.02, 1.2],
] as [number, number][]) {
  run({ speed: sp, sensorDistance: sd }, `speed ${sp}`)
}
