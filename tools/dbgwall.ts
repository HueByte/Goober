import { Colony, DEFAULT_ENV, DEFAULT_PARAMS } from '../src/sim/colony'
import { solidBounds } from '../src/sim/solids'
const grid = 96
for (const yaw of [0, 0.4]) {
  const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 100 }, { ...DEFAULT_ENV })
  const s = c.addSolid('wall', 'wood', 48, 2, 48, 1, false, [3, 30, 300], false, yaw)
  console.log(`yaw ${yaw}  half=${JSON.stringify(s?.half)} at=${JSON.stringify(s?.at)}`)
  console.log('  bounds:', solidBounds(s!).map((v) => v.toFixed(1)).join(', '))
  let rows = 0
  for (let z = 0; z < grid; z++) {
    let any = false
    for (let x = 0; x < grid; x++) if (c.solidMask.data[c.lattice.index(x, 1, z)] === 1) any = true
    if (any) rows++
  }
  let col = 0
  for (let y = 0; y < 40; y++) if (c.solidMask.data[c.lattice.index(48, y, 48)] === 1) col++
  console.log(`  floor rows with any solid: ${rows}/${grid}; solid voxels in column (48,*,48): ${col}`)
}
