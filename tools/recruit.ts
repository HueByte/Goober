/**
 * When one nucleus finds food, does the organism move - or does the finder just
 * multiply where it stands?
 *
 * The discriminator is where the mass at the deposit came from. Divisions
 * counted near it mean it grew there; a centre of mass that walked towards it
 * means the body went. Those are different organisms.
 */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'

const grid = 96
const FX = 76

function run(recruitment: number, hours = 24) {
  const c = new Colony(
    { ...DEFAULT_PARAMS, grid, maxMotes: 40000, recruitment },
    { ...DEFAULT_ENV },
  )
  c.inoculate(20, 4, 48, 240, 2.4)
  // A home deposit that runs out, so the question is what the colony does next.
  c.addFood('bacteria-lawn', 20, 4, 48, 45)
  c.addFood('bacteria-lawn', FX, 4, 48, 320)

  const centre = () => {
    let m = 0
    let sx = 0
    for (let i = 0; i < c.highWater; i++) {
      if (c.state[i] === 0) continue
      m += c.biomass[i]
      sx += c.px[i] * c.biomass[i]
    }
    return m > 0 ? sx / m : 0
  }
  const startX = centre()
  let homeMass = 0
  for (let h = 0; h < hours; h++) {
    for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
  }
  // Where is the organism now, and how is it split?
  let far = 0
  let home = 0
  for (let i = 0; i < c.highWater; i++) {
    if (c.state[i] === 0) continue
    if (c.px[i] > 60) far += c.biomass[i]
    else home += c.biomass[i]
  }
  homeMass = home
  const st = c.buildStats()
  const endX = centre()
  console.log(
    `recruitment ${recruitment.toFixed(1).padStart(4)} | centre of mass ${startX.toFixed(0)} -> ${endX
      .toFixed(1)
      .padStart(5)} | at the far deposit ${(far / 1000).toFixed(2).padStart(5)}mg, left behind ${(
      homeMass / 1000
    )
      .toFixed(2)
      .padStart(5)}mg (${((far / Math.max(far + homeMass, 1)) * 100).toFixed(0)}% of the body moved) | total ${st.biomassMg
      .toFixed(2)
      .padStart(5)}mg`,
  )
}

console.log('a small deposit at x=20 that runs out, a big one at x=76; 30 h')
for (const r of [0, 0.5, 1, 2, 3, 5]) run(r, 30)
