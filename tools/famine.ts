/** Does the colony actually die back without food, and does a ration hold it? */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'

function spread(c: Colony) {
  // How much of the plate the tube network covers.
  let v = 0
  for (let i = 0; i < c.vein.data.length; i++) if (c.vein.data[i] > 2) v++
  return v
}

function run(label: string, feed: 'none' | 'ration' | 'feast') {
  const grid = 96
  const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 60000 }, { ...DEFAULT_ENV })
  c.addFood('bacteria-lawn', grid * 0.5, 4, grid * 0.5, 220)
  c.inoculate(grid * 0.5, 4, grid * 0.5, 260, 2.4)
  console.log(`--- ${label} ---`)
  for (let h = 1; h <= 60; h++) {
    for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
    if (h % 8 === 0) {
      if (feed === 'ration') {
        const total = c.rationMassMg('bacteria-lawn', 8)
        c.scatterFood('bacteria-lawn', 6, Math.max(2, total / 6))
      } else if (feed === 'feast') {
        c.scatterFood('bacteria-lawn', 6, 120)
      }
      const st = c.buildStats()
      console.log(
        `   ${String(h).padStart(2)}h motes=${String(st.motes).padStart(5)} dorm=${String(
          st.dormant,
        ).padStart(4)} biomass=${st.biomassMg.toFixed(2).padStart(7)}mg tube=${String(
          spread(c),
        ).padStart(6)}vx food=${st.foodRemainingMg.toFixed(0).padStart(4)}mg`,
      )
    }
  }
}

run('no food after the first lawn', 'none')
run('upkeep ration every 8 h', 'ration')
run('120 mg x6 every 8 h', 'feast')
