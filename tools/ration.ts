/** What ration actually holds a colony steady? */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'

function run(scale: number) {
  const grid = 96
  const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 80000 }, { ...DEFAULT_ENV })
  c.addFood('bacteria-lawn', grid * 0.5, 4, grid * 0.5, 220)
  c.inoculate(grid * 0.5, 4, grid * 0.5, 260, 2.4)
  const trace: string[] = []
  for (let h = 1; h <= 72; h++) {
    for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
    if (h % 8 === 0) {
      const total = c.rationMassMg('bacteria-lawn', 8) * scale
      c.scatterFood('bacteria-lawn', 6, Math.max(2, total / 6))
      if (h % 24 === 0) trace.push(`${h}h=${c.buildStats().biomassMg.toFixed(1)}mg`)
    }
  }
  const st = c.buildStats()
  console.log(
    `ration x${scale.toFixed(2).padStart(5)}  ${trace.join('  ')}  final motes ${String(
      st.motes,
    ).padStart(5)} uneaten ${st.foodRemainingMg.toFixed(0)}mg`,
  )
}

for (const s of [1, 0.4, 0.2, 0.1, 0.05]) run(s)
