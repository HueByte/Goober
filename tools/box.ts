/**
 * A closed box, built the way the build panel builds one: four wall slabs at a
 * yaw, colony inoculated inside. Does anything get out, and if so, how?
 *
 * A single wall and a box are different questions. A box has corners, and two
 * slabs that meet at a corner only seal if they actually overlap there.
 */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'

const grid = 96
const CX = 48
const CZ = 48

function box(c: Colony, side: number, thickness: number, height: number, yaw: number, climbable: boolean, overlap: number) {
  const h = side / 2
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const put = (lx: number, lz: number, dims: [number, number, number]) => {
    const wx = CX + lx * cos - lz * sin
    const wz = CZ + lx * sin + lz * cos
    c.addSolid('wall', 'wood', wx, 2, wz, 1, false, dims, climbable, yaw)
  }
  // Long sides run along local z, end caps along local x. `overlap` extends each
  // slab past the corner.
  put(-h, 0, [thickness, height, side + overlap])
  put(h, 0, [thickness, height, side + overlap])
  put(0, -h, [side + overlap, height, thickness])
  put(0, h, [side + overlap, height, thickness])
}

function run(label: string, side: number, thickness: number, height: number, yaw: number, climbable: boolean, overlap: number) {
  const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 40000 }, { ...DEFAULT_ENV })
  box(c, side, thickness, height, yaw, climbable, overlap)
  c.inoculate(CX, 4, CZ, 240, 2.4)
  c.addFood('bacteria-lawn', CX, 4, CZ, 200)
  // Food outside, to give it a reason to try.
  c.addFood('bacteria-lawn', 12, 4, 12, 300)
  let topReached = 0
  for (let h = 0; h < 24; h++) {
    for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
    for (let i = 0; i < c.highWater; i++) {
      if (c.state[i] !== 0 && c.py[i] > topReached) topReached = c.py[i]
    }
  }
  // Outside = beyond the box in its own frame.
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  let out = 0
  let outMass = 0
  for (let i = 0; i < c.highWater; i++) {
    if (c.state[i] === 0) continue
    const dx = c.px[i] - CX
    const dz = c.pz[i] - CZ
    const lx = dx * cos + dz * sin
    const lz = -dx * sin + dz * cos
    if (Math.abs(lx) > side / 2 + thickness || Math.abs(lz) > side / 2 + thickness) {
      out++
      outMass += c.biomass[i]
    }
  }
  console.log(
    `${label.padEnd(40)} escaped ${String(out).padStart(4)} motes ${(outMass / 1000)
      .toFixed(2)
      .padStart(5)}mg | highest mote ${topReached.toFixed(1)} mm (wall ${height} mm)`,
  )
}

console.log('box 40 mm across, 3 mm walls, colony inside, food outside; 24 h')
for (const yaw of [0, 0.4, 0.785]) {
  run(`sheer  20mm walls, flush corners, yaw ${yaw.toFixed(2)}`, 40, 3, 20, yaw, false, 0)
}
for (const yaw of [0, 0.4, 0.785]) {
  run(`sheer  20mm walls, overlapped,   yaw ${yaw.toFixed(2)}`, 40, 3, 20, yaw, false, 6)
}
run('CLIMBABLE 20mm walls, overlapped,  yaw 0.40', 40, 3, 20, 0.4, true, 6)
run('CLIMBABLE 8mm walls,  overlapped,  yaw 0.40', 40, 3, 8, 0.4, true, 6)

console.log('')
console.log('and the thing that defeats a sheer wall: nothing holding the colony down')
for (const g of [0.4, 0.2, 0.05, 0]) {
  const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 40000 }, { ...DEFAULT_ENV, gravity: g })
  box(c, 40, 3, 20, 0.4, false, 6)
  c.inoculate(CX, 4, CZ, 240, 2.4)
  c.addFood('bacteria-lawn', CX, 4, CZ, 200)
  c.addFood('bacteria-lawn', 12, 4, 12, 300)
  for (let h = 0; h < 24; h++) for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
  const cos = Math.cos(0.4)
  const sin = Math.sin(0.4)
  let out = 0
  let top = 0
  for (let i = 0; i < c.highWater; i++) {
    if (c.state[i] === 0) continue
    if (c.py[i] > top) top = c.py[i]
    const lx = (c.px[i] - CX) * cos + (c.pz[i] - CZ) * sin
    const lz = -(c.px[i] - CX) * sin + (c.pz[i] - CZ) * cos
    if (Math.abs(lx) > 23 || Math.abs(lz) > 23) out++
  }
  console.log(`  gravity ${g.toFixed(2)}: ${String(out).padStart(4)} motes escaped a SHEER box | highest ${top.toFixed(1)} mm`)
}
