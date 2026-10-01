/** Does distant food stay dark until the body actually gets there? */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'

const grid = 96
const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 60000 }, { ...DEFAULT_ENV })
c.inoculate(20, 4, 48, 260, 2.4)
c.addFood('bacteria-lawn', 22, 4, 48, 200)
// A second deposit well away from the inoculum.
const fx = 76
c.addFood('bacteria-lawn', fx, 4, 48, 200)

console.log('distant deposit at x=76; the body starts at x=20')
for (let h = 1; h <= 40; h++) {
  for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
  if (h % 5 !== 0) continue
  // tube built within 6 mm of the distant deposit
  let tube = 0
  let bodyThere = 0
  let frontX = 0
  for (let z = 0; z < grid; z++)
    for (let y = 0; y < 12; y++)
      for (let x = 0; x < grid; x++) {
        const d = Math.hypot(x - fx, z - 48)
        if (d > 6) continue
        const i = x + grid * (y + grid * z)
        if (c.vein.data[i] > 8) tube++
        bodyThere += c.bio.data[i]
      }
  for (let i = 0; i < c.highWater; i++) if (c.state[i] !== 0 && c.px[i] > frontX) frontX = c.px[i]
  const st = c.buildStats()
  console.log(
    `${String(h).padStart(2)}h biomass=${st.biomassMg.toFixed(2).padStart(6)}mg front x=${frontX
      .toFixed(0)
      .padStart(3)} | at the distant deposit: body ${bodyThere.toFixed(0).padStart(5)}ug tube ${String(
      tube,
    ).padStart(4)}vx`,
  )
}
