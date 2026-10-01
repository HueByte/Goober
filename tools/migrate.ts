/**
 * Does the organism actually move, or does it just spread?
 *
 * One deposit to start on and one across the vessel. Once the first is eaten the
 * mass should migrate to the second and the tube network behind it should be
 * reabsorbed - a plasmodium relocates, it does not leave a copy of itself where
 * it used to be.
 */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'

const grid = 96
const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 60000 }, { ...DEFAULT_ENV })
const AX = 24
const BX = 76
c.inoculate(AX, 4, 48, 240, 2.4)
// A modest first deposit, so it runs out, and a generous one to move to.
c.addFood('bacteria-lawn', AX, 4, 48, 90)
c.addFood('bacteria-lawn', BX, 4, 48, 320)

// The lattice is sparse, so a voxel's index comes from the brick table.
const idx = (x: number, y: number, z: number) => c.lattice.index(x, y, z)

function near(fx: number): { tube: number; thick: number; body: number } {
  let tube = 0
  let thick = 0
  let body = 0
  for (let z = 0; z < grid; z++)
    for (let y = 0; y < 14; y++)
      for (let x = 0; x < grid; x++) {
        if (Math.hypot(x - fx, z - 48) > 8) continue
        const i = idx(x, y, z)
        if (c.vein.data[i] > 8) tube++
        if (c.vein.data[i] > 120) thick++
        body += c.bio.data[i]
      }
  return { tube, thick, body }
}

function centreX(): number {
  let m = 0
  let sum = 0
  for (let i = 0; i < c.highWater; i++) {
    if (c.state[i] === 0) continue
    sum += c.px[i] * c.biomass[i]
    m += c.biomass[i]
  }
  return m > 0 ? sum / m : 0
}

console.log('  h | biomass | centre x | home: tube thick body   | target: tube thick body')
for (let h = 1; h <= 48; h++) {
  for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
  if (h % 4 !== 0) continue
  const a = near(AX)
  const b = near(BX)
  const st = c.buildStats()
  console.log(
    `${String(h).padStart(3)} | ${st.biomassMg.toFixed(2).padStart(6)}mg | ${centreX()
      .toFixed(1)
      .padStart(8)} | ${String(a.tube).padStart(10)} ${String(a.thick).padStart(5)} ${a.body
      .toFixed(0)
      .padStart(5)}ug | ${String(b.tube).padStart(11)} ${String(b.thick).padStart(5)} ${b.body
      .toFixed(0)
      .padStart(5)}ug`,
  )
}
