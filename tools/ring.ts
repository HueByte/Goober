/** Why does the colony form a ring around a deposit? Radial profile over time. */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'

const grid = 96
const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 40000 }, { ...DEFAULT_ENV })
const cx = grid / 2
const cz = grid / 2
c.addFood('oat-flake', cx, 4, cz, 250)
c.inoculate(cx - 6, 4, cz, 260, 2.4)

const BINS = 12
const BIN = 2.5 // mm

function profile(label: string) {
  const motes = new Array(BINS).fill(0)
  const fed = new Array(BINS).fill(0)
  const carb = new Array(BINS).fill(0)
  const prot = new Array(BINS).fill(0)
  const cells = new Array(BINS).fill(0)

  for (let i = 0; i < c.highWater; i++) {
    if (c.state[i] === 0) continue
    const d = Math.hypot(c.px[i] - cx, c.pz[i] - cz)
    const b = Math.floor(d / BIN)
    if (b >= BINS) continue
    motes[b]++
    fed[b] += c.satiety[i]
  }
  // Sample the substrate in the plane the colony actually occupies.
  for (let z = 0; z < grid; z++) {
    for (let x = 0; x < grid; x++) {
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz)
      const b = Math.floor(d / BIN)
      if (b >= BINS) continue
      for (let y = 1; y <= 5; y++) {
        const i = c.lattice.index(x, y, z)
        carb[b] += c.carb.data[i]
        prot[b] += c.prot.data[i]
        cells[b]++
      }
    }
  }

  console.log(`${label}  t=${(c.timeMin / 60).toFixed(1)}h  motes=${c.motes}`)
  console.log(
    '   r(mm)  ' +
      Array.from({ length: BINS }, (_, b) => String((b * BIN).toFixed(0)).padStart(6)).join(''),
  )
  console.log('   motes ' + motes.map((v) => String(v).padStart(6)).join(''))
  console.log(
    '   sat   ' +
      motes.map((m, b) => (m ? (fed[b] / m).toFixed(2) : '  -  ').padStart(6)).join(''),
  )
  console.log(
    '   carb  ' + carb.map((v, b) => (v / Math.max(1, cells[b])).toFixed(2).padStart(6)).join(''),
  )
  console.log(
    '   prot  ' + prot.map((v, b) => (v / Math.max(1, cells[b])).toFixed(2).padStart(6)).join(''),
  )
  console.log()
}

for (const h of [2, 6, 14, 26]) {
  while (c.timeMin < h * 60) c.step(FIXED_STEP_MIN)
  profile(`>>`)
}
