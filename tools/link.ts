/**
 * Is there an unbroken tube between the body and the food it is feeding on?
 *
 * The visible complaint this answers: two lit patches on the plate with nothing
 * joining them. A plasmodium cannot do that - it is one cell, so whatever is on
 * the far deposit got there through a tube. This floods outwards from the
 * inoculum over every voxel whose tube is above the visible threshold and
 * reports whether the distant deposit is inside that connected component.
 */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'

const grid = 96
const VISIBLE = 8
const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 60000 }, { ...DEFAULT_ENV })
c.inoculate(20, 4, 48, 260, 2.4)
c.addFood('bacteria-lawn', 22, 4, 48, 200)
const fx = 76
c.addFood('bacteria-lawn', fx, 4, 48, 200)

// The lattice is sparse, so a voxel's index comes from the brick table.
const idx = (x: number, y: number, z: number) => c.lattice.index(x, y, z)

/** Flood fill over tube voxels from the inoculum; returns reach along x. */
function flood(): { seen: Uint8Array; count: number; maxX: number } {
  // Keyed by lattice index, which is what identifies a voxel now; the queue
  // carries packed coordinates because neighbours are found in space, not by
  // arithmetic on the index.
  const seen = new Uint8Array(c.vein.data.length)
  const queue: number[] = []
  const pack = (x: number, y: number, z: number) => x + grid * (y + grid * z)
  for (let z = 40; z < 56; z++)
    for (let y = 0; y < 12; y++)
      for (let x = 16; x < 26; x++) {
        const i = idx(x, y, z)
        if (c.vein.data[i] > VISIBLE && !seen[i]) {
          seen[i] = 1
          queue.push(pack(x, y, z))
        }
      }
  let count = queue.length
  let maxX = 0
  for (let h = 0; h < queue.length; h++) {
    const q = queue[h]
    const x = q % grid
    const y = ((q - x) / grid) % grid
    const z = (q - x - y * grid) / (grid * grid)
    if (x > maxX) maxX = x
    for (let d = 0; d < 6; d++) {
      const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0)
      const ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0)
      const nz = z + (d === 4 ? 1 : d === 5 ? -1 : 0)
      if (nx < 0 || ny < 0 || nz < 0 || nx >= grid || ny >= grid || nz >= grid) continue
      const j = idx(nx, ny, nz)
      if (seen[j] || c.vein.data[j] <= VISIBLE) continue
      seen[j] = 1
      count++
      queue.push(pack(nx, ny, nz))
    }
  }
  return { seen, count, maxX }
}

console.log('hours | motes  biomass | tube vx | connected vx  reach x | linked to the far deposit?')
for (let h = 1; h <= 40; h++) {
  for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
  if (h % 4 !== 0) continue
  const { seen, count, maxX } = flood()
  let total = 0
  let linked = 0
  let bodyThere = 0
  for (let z = 0; z < grid; z++)
    for (let y = 0; y < 14; y++)
      for (let x = 0; x < grid; x++) {
        const i = idx(x, y, z)
        if (c.vein.data[i] > VISIBLE) total++
        if (Math.hypot(x - fx, z - 48) <= 5) {
          bodyThere += c.bio.data[i]
          if (seen[i]) linked++
        }
      }
  const st = c.buildStats()
  console.log(
    `${String(h).padStart(5)} | ${String(st.motes).padStart(5)} ${st.biomassMg
      .toFixed(2)
      .padStart(6)}mg | ${String(total).padStart(7)} | ${String(count).padStart(12)} ${String(
      maxX,
    ).padStart(8)} | ${linked > 0 ? `YES (${linked} vx, body ${bodyThere.toFixed(0)}ug)` : `no (body ${bodyThere.toFixed(0)}ug)`}`,
  )
}
