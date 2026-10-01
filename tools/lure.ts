/** Does a smell with nothing behind it actually pull the colony? Averaged. */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'

const grid = 96
const TX = 74

function once(place: (c: Colony) => void): { near: number; centre: number } {
  const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 40000 }, { ...DEFAULT_ENV })
  c.inoculate(24, 4, 48, 220, 2.4)
  c.addFood('bacteria-lawn', 24, 4, 48, 180)
  place(c)
  for (let h = 0; h < 12; h++)
    for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
  let near = 0
  let m = 0
  let sum = 0
  for (let i = 0; i < c.highWater; i++) {
    if (c.state[i] === 0) continue
    const b = c.biomass[i]
    m += b
    sum += c.px[i] * b
    if (Math.hypot(c.px[i] - TX, c.pz[i] - 48) < 18) near += b
  }
  return { near: near / 1000, centre: m > 0 ? sum / m : 0 }
}

function trial(label: string, place: (c: Colony) => void, runs = 4) {
  let near = 0
  let centre = 0
  for (let r = 0; r < runs; r++) {
    const o = once(place)
    near += o.near
    centre += o.centre
  }
  console.log(
    `${label.padEnd(24)} mass within 18 mm of x=${TX}: ${(near / runs)
      .toFixed(2)
      .padStart(5)} mg | centre x ${(centre / runs).toFixed(1)}`,
  )
}

trial('bare agar', () => {})
trial('plain agar deposit', (c) => c.addFood('blank-agar', TX, 4, 48, 400))
trial('valerian (lure)', (c) => c.addFood('valerian-drop', TX, 4, 48, 150))
trial('real food', (c) => c.addFood('bacteria-lawn', TX, 4, 48, 300))
