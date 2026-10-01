/**
 * Is the network branched, or is it a blob?
 *
 * For every vein voxel, count how many of its 26 neighbours are also vein. A
 * voxel inside a solid mass has ~26; a voxel in a one-voxel-wide arm has 2-6.
 * The fraction below 8 is a decent proxy for "how much of this thing is arms",
 * and the radius of gyration says how far those arms reach.
 */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'
import type { SimParams } from '../src/sim/types'

const THRESH = 6

function measure(label: string, over: Partial<SimParams>, hours = 16) {
  const grid = 96
  const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 40000, ...over }, { ...DEFAULT_ENV })
  c.addFood('oat-flake', grid * 0.3, 4, grid * 0.35, 250)
  c.addFood('oat-flake', grid * 0.72, 4, grid * 0.62, 250)
  c.addFood('defined-medium', grid * 0.4, 4, grid * 0.78, 300)
  c.inoculate(grid * 0.5, 4, grid * 0.5, 260, 2.4)
  while (c.timeMin < hours * 60) c.step(FIXED_STEP_MIN)

  const n = c.n
  const nn = n * n
  const d = c.vein.data
  let count = 0
  let thin = 0
  let sx = 0
  let sy = 0
  let sz = 0
  const pts: number[] = []
  for (let z = 1; z < n - 1; z++) {
    for (let y = 1; y < n - 1; y++) {
      for (let x = 1; x < n - 1; x++) {
        const i = nn * z + n * y + x
        if (d[i] <= THRESH) continue
        count++
        sx += x
        sy += y
        sz += z
        pts.push(i)
        let nb = 0
        for (let dz = -1; dz <= 1; dz++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy && !dz) continue
              if (d[i + dx + n * dy + nn * dz] > THRESH) nb++
            }
        if (nb < 8) thin++
      }
    }
  }
  if (count === 0) {
    console.log(`${label.padEnd(22)} no network`)
    return
  }
  const cx = sx / count
  const cy = sy / count
  const cz = sz / count
  let rg = 0
  for (const i of pts) {
    const x = i % n
    const y = ((i - x) / n) % n
    const z = (i - x - y * n) / nn
    rg += (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2
  }
  rg = Math.sqrt(rg / count)
  const st = c.buildStats()
  console.log(
    `${label.padEnd(22)} vein ${String(count).padStart(6)} vx | thin ${((thin / count) * 100)
      .toFixed(0)
      .padStart(3)}% | reach ${rg.toFixed(1).padStart(5)} mm | motes ${String(st.motes).padStart(
      5,
    )} | biomass ${st.biomassMg.toFixed(2)} mg`,
  )
}

console.log('network shape after 16 h (higher thin%% and reach = more arms, less blob):')
measure('current', {})
measure('narrow 0.35', { sensorAngle: 0.35 })
measure('narrow 0.25', { sensorAngle: 0.25 })
measure('narrow + decay', { sensorAngle: 0.32, trailDecayPerMin: 0.09 })
measure('narrow + far', { sensorAngle: 0.32, sensorDistance: 3.4 })
measure('narrow + calm', { sensorAngle: 0.32, randomness: 0.06 })
measure('combo A', { sensorAngle: 0.3, sensorDistance: 3.2, trailDecayPerMin: 0.08, randomness: 0.07 })
measure('combo A + trail', {
  sensorAngle: 0.3,
  sensorDistance: 3.2,
  trailDecayPerMin: 0.08,
  randomness: 0.07,
  trailAffinity: 2.2,
})
measure('combo B', {
  sensorAngle: 0.28,
  sensorDistance: 3.6,
  trailDecayPerMin: 0.06,
  trailDiffusion: 0.06,
  randomness: 0.06,
  turnRate: 1.3,
})
