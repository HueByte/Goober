/** Why is a colony sitting on a bacterial lawn not thriving? */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'

const grid = 96
const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 40000 }, { ...DEFAULT_ENV })
c.addFood('bacteria-lawn', grid / 2, 4, grid / 2, 260)
c.inoculate(grid / 2, 4, grid / 2, 260, 2.4)

let lastIntakeC = 0
let lastIntakeP = 0
for (let h = 1; h <= 16; h++) {
  for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
  let sat = 0
  let n = 0
  let bioHere = 0
  let carbHere = 0
  let protHere = 0
  let dist = 0
  for (let i = 0; i < c.highWater; i++) {
    if (c.state[i] !== 1) continue
    n++
    sat += c.satiety[i]
    bioHere += c.bio.nearest(c.px[i], c.py[i], c.pz[i])
    carbHere += c.carb.nearest(c.px[i], c.py[i], c.pz[i])
    protHere += c.prot.nearest(c.px[i], c.py[i], c.pz[i])
    dist += Math.hypot(c.px[i] - grid / 2, c.pz[i] - grid / 2)
  }
  const st = c.buildStats()
  const f = c.foods[0]
  console.log(
    `${String(h).padStart(2)}h motes=${String(st.motes).padStart(4)} dorm=${String(st.dormant).padStart(3)}` +
      ` bm=${st.biomassMg.toFixed(2)}mg sat=${(sat / Math.max(1, n)).toFixed(2)}` +
      ` bio@mote=${(bioHere / Math.max(1, n)).toFixed(0)} C@mote=${(carbHere / Math.max(1, n)).toFixed(2)}` +
      ` P@mote=${(protHere / Math.max(1, n)).toFixed(2)} dist=${(dist / Math.max(1, n)).toFixed(1)}mm` +
      ` col=${f ? f.colonization.toFixed(2) : '-'} intakeC=${((c.intakeCarb - lastIntakeC) / 60).toFixed(3)}` +
      ` intakeP=${((c.intakeProtein - lastIntakeP) / 60).toFixed(3)} ug/min` +
      ` circ=${(c.circulatingCarb + c.circulatingProtein).toFixed(1)}`,
  )
  lastIntakeC = c.intakeCarb
  lastIntakeP = c.intakeProtein
}
