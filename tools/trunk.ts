/** How thick is the tube along the route between the body and distant food? */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'

const grid = 96
const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 60000 }, { ...DEFAULT_ENV })
c.inoculate(20, 4, 48, 260, 2.4)
c.addFood('bacteria-lawn', 22, 4, 48, 200)
c.addFood('bacteria-lawn', 76, 4, 48, 200)

// The lattice is sparse, so a voxel's index comes from the brick table.
const idx = (x: number, y: number, z: number) => c.lattice.index(x, y, z)

function profile(): string {
  const out: string[] = []
  for (let x = 20; x <= 80; x += 5) {
    let best = 0
    for (let z = 0; z < grid; z++)
      for (let y = 0; y < 14; y++) {
        const v = c.vein.data[idx(x, y, z)]
        if (v > best) best = v
      }
    out.push(best.toFixed(0).padStart(4))
  }
  return out.join('')
}

function bands(): string {
  // How the whole tube field is distributed, so we can see haze vs trunk.
  const edges = [8, 20, 50, 120, 250, 420]
  const n = new Array(edges.length).fill(0)
  for (let i = 0; i < c.vein.data.length; i++) {
    const v = c.vein.data[i]
    for (let b = edges.length - 1; b >= 0; b--)
      if (v > edges[b]) {
        n[b]++
        break
      }
  }
  return n.map((v, b) => `>${edges[b]}:${v}`).join(' ')
}

console.log('        x:' + Array.from({ length: 13 }, (_, i) => String(20 + i * 5).padStart(4)).join(''))
for (let h = 1; h <= 36; h++) {
  for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
  if (h % 6 !== 0) continue
  console.log(`${String(h).padStart(2)}h peak:${profile()}`)
  console.log(`      bands: ${bands()}`)
}
