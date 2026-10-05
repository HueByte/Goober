/**
 * Does a starving colony go looking?
 *
 * Not the easy version, where the far deposit has been diffusing a plume since
 * hour zero. This one: eat everything, and only then put food somewhere else.
 * The colony has to cross ground it has no information about.
 */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'

const grid = 96

function run(label: string, dist: number, tweak: Partial<typeof DEFAULT_PARAMS> = {}) {
  const c = new Colony(
    { ...DEFAULT_PARAMS, ...tweak, grid, maxMotes: 40000 },
    { ...DEFAULT_ENV },
  )
  c.inoculate(20, 4, 48, 240, 2.4)
  c.addFood('bacteria-lawn', 20, 4, 48, 60)
  // Run until the larder is bare.
  let starvedAt = -1
  for (let h = 0; h < 18; h++) {
    for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
    if (c.foods.length === 0 && starvedAt < 0) starvedAt = h
  }
  const atFamine = c.buildStats()
  // Now something to find, with no warning.
  const fx = 20 + dist
  c.addFood('bacteria-lawn', fx, 4, 48, 320)
  let foundAt = -1
  let reach = 0
  for (let h = 0; h < 48; h++) {
    for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
    let far = 0
    let maxX = 0
    for (let i = 0; i < c.highWater; i++) {
      if (c.state[i] === 0) continue
      if (c.px[i] > maxX) maxX = c.px[i]
      if (Math.abs(c.px[i] - fx) < 8) far += c.biomass[i]
    }
    if (maxX > reach) reach = maxX
    if (far > 300 && foundAt < 0) foundAt = h
  }
  const end = c.buildStats()
  console.log(
    `${label.padEnd(28)} famine at ${String(starvedAt).padStart(2)}h with ${atFamine.biomassMg
      .toFixed(2)
      .padStart(5)}mg | food ${dist} mm away: ${
      foundAt >= 0 ? `found after ${String(foundAt).padStart(2)}h` : 'NEVER FOUND    '
    } | furthest reach ${reach.toFixed(0).padStart(3)} mm | ended ${end.biomassMg
      .toFixed(2)
      .padStart(5)}mg, ${end.dormant} dormant`,
  )
}

for (const d of [30, 50, 70]) run(`as shipped, ${d} mm away`, d)

console.log('')
console.log('and with something in the way, which is the case that matters')

function runWalled(label: string, gapZ: number, bigColony: boolean) {
  const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 40000 }, { ...DEFAULT_ENV })
  // A wall across the vessel at x=46 with one gap in it.
  for (let z = 2; z < grid - 2; z += 8) {
    if (Math.abs(z + 4 - gapZ) < 8) continue
    c.addSolid('wall', 'wood', 46, 2, z + 4, 1, false, [3, 20, 9], false, 0)
  }
  c.inoculate(20, 4, 48, 240, 2.4)
  c.addFood('bacteria-lawn', 20, 4, 48, bigColony ? 320 : 60)
  let hungryAt = -1
  for (let h = 0; h < (bigColony ? 40 : 18); h++) {
    for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
    if (c.foods.length === 0 && hungryAt < 0) hungryAt = h
  }
  const famine = c.buildStats()
  c.addFood('bacteria-lawn', 78, 4, 48, 320)
  let foundAt = -1
  let through = 0
  for (let h = 0; h < 60; h++) {
    for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
    let far = 0
    let past = 0
    for (let i = 0; i < c.highWater; i++) {
      if (c.state[i] === 0) continue
      if (c.px[i] > 50) past++
      if (Math.abs(c.px[i] - 78) < 8) far += c.biomass[i]
    }
    if (past > through) through = past
    if (far > 300 && foundAt < 0) foundAt = h
  }
  const end = c.buildStats()
  console.log(
    `${label.padEnd(36)} ${famine.biomassMg.toFixed(2).padStart(5)}mg at famine | ${
      foundAt >= 0 ? `found after ${String(foundAt).padStart(2)}h` : 'NEVER FOUND    '
    } | most motes past the wall ${String(through).padStart(4)} | ended ${end.biomassMg
      .toFixed(2)
      .padStart(5)}mg, ${end.dormant} dormant`,
  )
}

runWalled('small colony, gap opposite', 48, false)
runWalled('small colony, gap off to one side', 12, false)
runWalled('BIG colony, gap opposite', 48, true)
runWalled('BIG colony, gap off to one side', 12, true)
