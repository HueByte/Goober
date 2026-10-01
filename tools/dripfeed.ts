/**
 * Does a drip feed keep the colony travelling, rather than sat on one spot?
 *
 * The question is not whether it survives - a pile of food in one place does
 * that - but whether the centre of mass keeps moving, which is what makes the
 * network interesting to look at.
 */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'

const grid = 128

function run(label: string, everyHours: number, reach: number, hours = 72) {
  const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 60000 }, { ...DEFAULT_ENV })
  c.inoculate(64, 4, 64, 260, 2.4)
  c.addFood('bacteria-lawn', 64, 4, 64, 200)
  let next = everyHours * 60
  let px = 64
  let pz = 64
  let travelled = 0
  let drops = 0
  for (let h = 1; h <= hours; h++) {
    for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
    if (everyHours > 0 && c.timeMin >= next) {
      next = c.timeMin + everyHours * 60
      const share = c.rationMassMg('bacteria-lawn', everyHours) / 6
      c.scatterBeyond(["bacteria-lawn"], 6, reach, Math.max(6, share))
      drops++
    }
    let m = 0
    let sx = 0
    let sz = 0
    for (let i = 0; i < c.highWater; i++) {
      if (c.state[i] === 0) continue
      m += c.biomass[i]
      sx += c.px[i] * c.biomass[i]
      sz += c.pz[i] * c.biomass[i]
    }
    if (m > 0) {
      const x = sx / m
      const z = sz / m
      travelled += Math.hypot(x - px, z - pz)
      px = x
      pz = z
    }
  }
  const st = c.buildStats()
  console.log(
    `${label.padEnd(26)} ${drops} drops | biomass ${st.biomassMg.toFixed(2).padStart(6)}mg motes ${String(
      st.motes,
    ).padStart(5)} dorm ${String(st.dormant).padStart(4)} | centre of mass travelled ${travelled
      .toFixed(0)
      .padStart(4)} mm, now at (${px.toFixed(0)}, ${pz.toFixed(0)}) | deposits left ${c.foods.length}`,
  )
}

run('no feeding at all', 0, 0)
run('every 6 h, within 15 mm', 6, 15)
run('every 6 h, within 40 mm', 6, 40)
run('every 6 h, within 90 mm', 6, 90)
run('every 2 h, within 40 mm', 2, 40)
