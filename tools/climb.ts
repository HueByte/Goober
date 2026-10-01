import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'
import type { Material } from '../src/sim/solids'

/** A bare pillar with food on top and a snack at the bottom. */
function tower(material: Material, gravity: number, climbable = true) {
  const grid = 96
  const c = new Colony(
    { ...DEFAULT_PARAMS, grid, maxMotes: 40000 },
    { ...DEFAULT_ENV, gravity },
  )
  c.addSolid('pillar', material, grid / 2, 0, grid / 2, 0.9, false, undefined, climbable)
  const top = c.solids[0].y + c.solids[0].hy
  c.addFood('bacteria-lawn', grid / 2, top + 2, grid / 2, 300)
  c.addFood('oat-flake', grid / 2 - 18, 4, grid / 2, 150)
  c.inoculate(grid / 2 - 18, 4, grid / 2, 280, 2.4)
  return { c, top }
}

function report(label: string, c: Colony, top: number) {
  const cx = c.n / 2
  const bins = [0, 0, 0, 0, 0, 0]
  let onPillar = 0
  let maxY = 0
  for (let i = 0; i < c.highWater; i++) {
    if (c.state[i] === 0) continue
    const r = Math.hypot(c.px[i] - cx, c.pz[i] - cx)
    if (r < 6) onPillar++
    if (c.py[i] > maxY) maxY = c.py[i]
    bins[Math.min(5, Math.floor((c.py[i] / top) * 5))]++
  }
  const st = c.buildStats()
  console.log(
    `${label} t=${(c.timeMin / 60).toFixed(0)}h maxY=${maxY.toFixed(1)}/${top.toFixed(
      1,
    )} nearPillar=${onPillar} heights=[${bins.join(',')}] motes=${st.motes} bm=${st.biomassMg.toFixed(
      1,
    )}mg tears=${st.tears} topFoodLeft=${c.foods[0] ? (c.foods[0].pools.protein + c.foods[0].pools.water).toFixed(0) : 'gone'}`,
  )
}

for (const [material, gravity, climbable] of [
  ['wood', 0.6, true],
  ['wood', 0.0, true],
  ['wood', 0.6, false],
  ['wood', 0.0, false],
] as [Material, number, boolean][]) {
  const { c, top } = tower(material, gravity, climbable)
  console.log(
    `--- ${material}, gravity ${gravity}, ${climbable ? 'climbable' : 'SHEER'}, pillar top ${top.toFixed(1)} mm ---`,
  )
  for (let h = 1; h <= 20; h++) {
    for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
    if (h % 10 === 0) report(`   `, c, top)
  }
}
