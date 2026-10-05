/**
 * Does a wall stop a smell?
 *
 * A quinine crystal on one side of a barrier, and the colony on the other. The
 * question is not whether the colony survives but whether it is being repelled
 * by something it cannot reach and cannot be harmed by.
 */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'

const grid = 96

function probe(label: string, build: (c: Colony) => void) {
  const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 8000 }, { ...DEFAULT_ENV })
  build(c)
  c.step(FIXED_STEP_MIN)
  // Sample the fields on the far side of where the wall goes, and on the near
  // side at the same distance, so the only difference is the barrier.
  const near = { r: 0, l: 0, n: 0 }
  const far = { r: 0, l: 0, n: 0 }
  for (let z = 36; z < 60; z++) {
    near.r += c.envGrid.repelAt(42, 4, z)
    near.l += c.envGrid.lureAt(42, 4, z)
    near.n += c.envGrid.narcoticAt(42, 4, z)
    far.r += c.envGrid.repelAt(54, 4, z)
    far.l += c.envGrid.lureAt(54, 4, z)
    far.n += c.envGrid.narcoticAt(54, 4, z)
  }
  console.log(
    `${label.padEnd(34)} repellent near ${near.r.toFixed(2).padStart(6)} far ${far.r
      .toFixed(2)
      .padStart(6)} (${((far.r / Math.max(near.r, 1e-9)) * 100).toFixed(0)}% got through) | lure near ${near.l
      .toFixed(2)
      .padStart(5)} far ${far.l.toFixed(2).padStart(5)}`,
  )
}

// Deposit at x=36, wall at x=48, far probe at x=54.
const deposit = (c: Colony) => {
  for (let z = 38; z < 58; z += 4) c.addFood('quinine', 36, 4, z, 80)
  for (let z = 38; z < 58; z += 4) c.addFood('valerian-drop', 36, 4, z, 150)
}
const wall = (c: Colony, yaw: number) =>
  c.addSolid('wall', 'wood', 48, 2, 48, 1, false, [3, 20, 90], false, yaw)

probe('no wall', (c) => deposit(c))
probe('wall between them', (c) => {
  wall(c, 0)
  deposit(c)
})
probe('wall at 23 degrees', (c) => {
  wall(c, 0.4)
  deposit(c)
})
