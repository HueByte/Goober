/**
 * How directly does the colony get to food it can smell?
 *
 * Tortuosity: the distance the centre of mass actually travelled, divided by
 * how far it ended up from where it started. 1.0 is a straight line; 2.0 means
 * it took twice the road it needed to.
 */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'

const grid = 96

function centre(c: Colony): [number, number] {
  let m = 0
  let sx = 0
  let sz = 0
  for (let i = 0; i < c.highWater; i++) {
    if (c.state[i] === 0) continue
    const b = c.biomass[i]
    m += b
    sx += c.px[i] * b
    sz += c.pz[i] * b
  }
  return m > 0 ? [sx / m, sz / m] : [0, 0]
}

function trial(label: string, foodId: string, hours = 20) {
  const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 40000 }, { ...DEFAULT_ENV })
  c.inoculate(20, 4, 48, 220, 2.4)
  c.addFood('bacteria-lawn', 20, 4, 48, 150)
  c.addFood(foodId, 74, 4, 48, 320)
  let [px, pz] = centre(c)
  const [ox, oz] = [px, pz]
  let travelled = 0
  for (let h = 0; h < hours; h++) {
    for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
    const [x, z] = centre(c)
    travelled += Math.hypot(x - px, z - pz)
    px = x
    pz = z
  }
  const net = Math.hypot(px - ox, pz - oz)
  const toTarget = Math.hypot(74 - px, 48 - pz)
  console.log(
    `${label.padEnd(20)} travelled ${travelled.toFixed(1).padStart(5)} mm, net ${net
      .toFixed(1)
      .padStart(5)} mm -> tortuosity ${(travelled / Math.max(net, 0.01))
      .toFixed(2)
      .padStart(5)} | still ${toTarget.toFixed(0)} mm short`,
  )
}

trial('bacterial lawn', 'bacteria-lawn')
trial('oat flake', 'oat-flake')
trial('fish flake', 'fish-flake')
trial('malt extract', 'malt-extract')
trial('valerian (smell only)', 'valerian-drop')
