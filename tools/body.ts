/**
 * Does it behave as one cell?
 *
 * Measures how much of the colony is attached to the body, how compact it is,
 * and - with food off to one side - whether its mass actually shifts that way.
 */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'
import type { SimParams } from '../src/sim/types'

function run(label: string, over: Partial<SimParams>) {
  const grid = 96
  const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 40000, ...over }, { ...DEFAULT_ENV })
  // Inoculum at the centre, all the food well off to one side.
  c.inoculate(grid * 0.5, 4, grid * 0.5, 260, 2.4)
  c.addFood('bacteria-lawn', grid * 0.78, 4, grid * 0.5, 260)
  c.addFood('bacteria-lawn', grid * 0.84, 4, grid * 0.62, 260)
  for (let s = 0; s < (20 * 60) / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)

  let n = 0
  let sx = 0
  let sz = 0
  let detached = 0
  let massX = 0
  for (let i = 0; i < c.highWater; i++) {
    if (c.state[i] === 0) continue
    n++
    sx += c.px[i]
    sz += c.pz[i]
    massX += c.px[i] * c.biomass[i]
    // "Attached" means there is a body around it, not just itself.
    if (c.bio.nearest(c.px[i], c.py[i], c.pz[i]) < 20) detached++
  }
  if (n === 0) {
    console.log(`${label.padEnd(20)} extinct`)
    return
  }
  const cx = sx / n
  const cz = sz / n
  let spread = 0
  for (let i = 0; i < c.highWater; i++) {
    if (c.state[i] === 0) continue
    spread += (c.px[i] - cx) ** 2 + (c.pz[i] - cz) ** 2
  }
  spread = Math.sqrt(spread / n)
  const st = c.buildStats()
  const bias = massX / Math.max(1e-9, c.totalBiomassUg())
  console.log(
    `${label.padEnd(20)} motes ${String(st.motes).padStart(5)} | biomass ${st.biomassMg
      .toFixed(2)
      .padStart(6)}mg | detached ${((detached / n) * 100).toFixed(0).padStart(3)}% | spread ${spread
      .toFixed(1)
      .padStart(5)}mm | centre of mass x=${bias.toFixed(1)} (food at 75-81, start 48)`,
  )
}

console.log('one cell, or a cloud? food is off to one side at x=75-81 mm:')
run('current', {})
run('no cohesion', { cohesion: 0 })
run('no streaming', { circulation: 0 })
run('neither', { cohesion: 0, circulation: 0 })
run('cohesion x2', { cohesion: 4.4 })
