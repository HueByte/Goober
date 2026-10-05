/**
 * Is a wall actually a wall?
 *
 * Not "did any mote get past" - with a rotated wall that is ambiguous - but the
 * property itself: flood the floor from one corner over everything that is not
 * solid, and see whether it reaches the far corner. If it does, the wall has a
 * hole in it, whatever its volume says.
 */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS } from '../src/sim/colony'

const grid = 96

function leaks(thickness: number, yaw: number, layers = 4): { reached: boolean; open: number } {
  const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 100 }, { ...DEFAULT_ENV })
  // One wall, long enough that its ends leave the vessel at any angle.
  c.addSolid('wall', 'wood', 48, 2, 48, 1, false, [thickness, 30, 300], false, yaw)
  const mask = c.solidMask.data
  const solidAt = (x: number, y: number, z: number) => mask[c.lattice.index(x, y, z)] === 1
  const seen = new Uint8Array(grid * grid * layers)
  const key = (x: number, y: number, z: number) => x + grid * (z + grid * y)
  // Seed from the whole z = 0 edge on the low-x side of the wall.
  const q: number[] = []
  for (let y = 0; y < layers; y++)
    for (let x = 0; x < grid; x++) {
      // Which side of the wall is this? Walls run along local z, so the normal
      // in the floor plane is (cos yaw, -sin yaw) by the same convention.
      const nx = Math.cos(yaw)
      const nz = -Math.sin(yaw)
      const d = (x + 0.5 - 48) * nx + (0.5 - 48) * nz
      if (d > -6) continue
      if (solidAt(x, y, 0)) continue
      const k = key(x, y, 0)
      if (!seen[k]) {
        seen[k] = 1
        q.push(x, y, 0)
      }
    }
  let reached = false
  for (let h = 0; h < q.length; h += 3) {
    const x = q[h]
    const y = q[h + 1]
    const z = q[h + 2]
    const nx = Math.cos(yaw)
    const nz = -Math.sin(yaw)
    if ((x + 0.5 - 48) * nx + (z + 0.5 - 48) * nz > 6) reached = true
    for (let d = 0; d < 6; d++) {
      const ax = x + (d === 0 ? 1 : d === 1 ? -1 : 0)
      const ay = y + (d === 2 ? 1 : d === 3 ? -1 : 0)
      const az = z + (d === 4 ? 1 : d === 5 ? -1 : 0)
      if (ax < 0 || az < 0 || ay < 0 || ax >= grid || az >= grid || ay >= layers) continue
      if (solidAt(ax, ay, az)) continue
      const k = key(ax, ay, az)
      if (seen[k]) continue
      seen[k] = 1
      q.push(ax, ay, az)
    }
  }
  let open = 0
  for (let i = 0; i < seen.length; i++) if (seen[i]) open++
  return { reached, open }
}

console.log('thickness  yaw   leaks through?')
for (const t of [1, 2, 3]) {
  for (const yaw of [0, 0.2, 0.4, 0.6, 0.785, 1.0, 1.2]) {
    const r = leaks(t, yaw)
    console.log(
      `   ${t} mm   ${yaw.toFixed(2)}   ${r.reached ? 'LEAKS' : 'sealed'}  (${r.open} floor voxels flooded)`,
    )
  }
}
