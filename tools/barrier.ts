/**
 * Do barriers actually stop it?
 *
 * A wall across the vessel with food on the far side, and the same test with a
 * line of antagonist instead. Two different failures look identical from above:
 * going *through* a wall is a collision bug, going *over* it is the organism
 * doing exactly what it is told to do by thigmotaxis. This separates them.
 */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'

const grid = 96
const WALL_X = 48

function run(label: string, build: (c: Colony) => void, hours = 24) {
  const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 40000 }, { ...DEFAULT_ENV })
  build(c)
  c.inoculate(20, 4, 48, 240, 2.4)
  c.addFood('bacteria-lawn', 20, 4, 48, 160)
  c.addFood('bacteria-lawn', 76, 4, 48, 320)
  let maxHeight = 0
  let everInside = 0
  for (let h = 0; h < hours; h++) {
    for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
    for (let i = 0; i < c.highWater; i++) {
      if (c.state[i] === 0) continue
      if (Math.abs(c.px[i] - WALL_X) < 3 && c.py[i] > maxHeight) maxHeight = c.py[i]
      if (c.isSolid(c.px[i], c.py[i], c.pz[i])) everInside++
    }
  }
  // Who got past, and how.
  let past = 0
  let pastMass = 0
  for (let i = 0; i < c.highWater; i++) {
    if (c.state[i] === 0) continue
    if (c.px[i] > WALL_X + 4) {
      past++
      pastMass += c.biomass[i]
    }
  }
  let tubePast = 0
  for (let z = 0; z < grid; z++)
    for (let y = 0; y < 20; y++)
      for (let x = WALL_X + 4; x < grid; x++)
        if (c.vein.data[c.lattice.index(x, y, z)] > 8) tubePast++
  console.log(
    `${label.padEnd(30)} past the line: ${String(past).padStart(4)} motes ${(pastMass / 1000)
      .toFixed(2)
      .padStart(5)}mg, ${String(tubePast).padStart(5)} tube vx | highest at the line ${maxHeight
      .toFixed(1)
      .padStart(5)} mm | inside-solid samples ${everInside}`,
  )
}

function wall(c: Colony, climbable: boolean, height: number) {
  // A solid barrier from z=0 to z=96, pierced by nothing.
  for (let z = 2; z < grid - 2; z += 6) {
    c.addSolid('wall', 'wood', WALL_X, 2, z + 3, 1, false, [2, height, 7], climbable, 0)
  }
}

console.log('--- no barrier at all (the control) ---')
run('open plate', () => {})
console.log('')
console.log('--- solid wall ---')
run('climbable wall, 12 mm', (c) => wall(c, true, 12))
run('climbable wall, 30 mm', (c) => wall(c, true, 30))
run('SHEER wall, 12 mm', (c) => wall(c, false, 12))
run('SHEER wall, 30 mm', (c) => wall(c, false, 30))
console.log('')
console.log('--- chemical barrier ---')
run('quinine line', (c) => {
  for (let z = 4; z < grid - 4; z += 5) c.addFood('quinine', WALL_X, 4, z, 80)
})
run('salt line', (c) => {
  for (let z = 4; z < grid - 4; z += 5) c.addFood('salt-crystal', WALL_X, 4, z, 60)
})
run('copper line', (c) => {
  for (let z = 4; z < grid - 4; z += 5) c.addFood('copper-sulfate', WALL_X, 4, z, 50)
})

console.log('')
console.log('--- the same wall, rotated ---')
for (const yaw of [0, 0.2, 0.4, 0.6, 0.785, 1.0]) {
  // One continuous slab, not a row of segments: rotating segments about their
  // own centres leaves gaps between them, which would be the test rig's fault
  // rather than the simulation's.
  run(`SHEER 2mm wall, yaw ${yaw.toFixed(2)}`, (c) => {
    c.addSolid('wall', 'wood', WALL_X, 2, 48, 1, false, [2, 30, 150], false, yaw)
  })
}

console.log('')
console.log('--- how porous is the mask? solid voxels per object ---')
{
  const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 1000 }, { ...DEFAULT_ENV })
  for (const yaw of [0, 0.2, 0.4, 0.6, 0.785]) {
    const d = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 1000 }, { ...DEFAULT_ENV })
    d.addSolid('wall', 'wood', 48, 2, 48, 1, false, [2, 30, 40], false, yaw)
    let solid = 0
    for (let z = 0; z < grid; z++)
      for (let y = 0; y < 40; y++)
        for (let x = 0; x < grid; x++)
          if (d.solidMask.data[d.lattice.index(x, y, z)] === 1) solid++
    // A 2 x 30 x 40 slab is 2400 mm3 however it is turned.
    console.log(
      `  yaw ${yaw.toFixed(2)}: ${String(solid).padStart(5)} solid voxels of an expected 2400 (${(
        (solid / 2400) *
        100
      ).toFixed(0)}%)`,
    )
  }
  void c
}
