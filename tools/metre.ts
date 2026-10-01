/**
 * The one-metre vessel.
 *
 * What matters here is not that it runs but that it costs what the colony is,
 * not what the container is: an empty metre should be free, and the bill should
 * climb only as the organism spreads into it.
 */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'

const grid = 1000
const t0 = Date.now()
const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 120000 }, { ...DEFAULT_ENV })
console.log(
  `empty 1 m vessel: ${(c.fieldBytes / 1048576).toFixed(2)} MB, built in ${Date.now() - t0} ms`,
)
console.log(`  dense would have been ${((grid ** 3 * 35) / 1073741824).toFixed(1)} GB`)

c.inoculate(500, 4, 500, 400, 3)
c.addFood('bacteria-lawn', 500, 4, 500, 400)
// Deposits out at genuine distance, which is the point of a metre of agar.
for (const [dx, dz] of [
  [60, 0],
  [-60, 40],
  [0, -70],
  [90, 90],
]) {
  c.addFood('oat-flake', 500 + dx, 4, 500 + dz, 300)
}

console.log('')
console.log('   h |   motes  biomass | field MB | ms/step | front spread mm')
for (let h = 1; h <= 60; h++) {
  const t = Date.now()
  let steps = 0
  for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) {
    c.step(FIXED_STEP_MIN)
    steps++
  }
  const ms = (Date.now() - t) / steps
  if (h % 10 !== 0) continue
  let x0 = 1e9
  let x1 = -1e9
  let z0 = 1e9
  let z1 = -1e9
  for (let i = 0; i < c.highWater; i++) {
    if (c.state[i] === 0) continue
    if (c.px[i] < x0) x0 = c.px[i]
    if (c.px[i] > x1) x1 = c.px[i]
    if (c.pz[i] < z0) z0 = c.pz[i]
    if (c.pz[i] > z1) z1 = c.pz[i]
  }
  const st = c.buildStats()
  console.log(
    `${String(h).padStart(4)} | ${String(st.motes).padStart(7)} ${st.biomassMg
      .toFixed(2)
      .padStart(7)}mg | ${(c.fieldBytes / 1048576).toFixed(1).padStart(8)} | ${ms
      .toFixed(2)
      .padStart(7)} | ${(x1 - x0).toFixed(0)} x ${(z1 - z0).toFixed(0)}${
      c.fieldBudgetReached ? '  [budget reached]' : ''
    }`,
  )
}
