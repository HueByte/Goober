import {
  Colony,
  DEFAULT_ENV,
  DEFAULT_PARAMS,
  FIXED_STEP_MIN,
  maxGridSize,
} from '../src/sim/colony'

console.log(`vessel cap: ${maxGridSize()} mm`)
const c = new Colony({ ...DEFAULT_PARAMS, grid: 96, maxMotes: 20000 }, { ...DEFAULT_ENV })
c.setParams({ grid: 400 })
console.log(`asked for 400 mm, got ${c.n} mm -> allowed: ${c.n === 400}`)
console.log(`  empty 400 mm vessel holds ${(c.fieldBytes / 1048576).toFixed(2)} MB of field`)
c.setParams({ grid: 1000 })
console.log(`asked for 1000 mm, got ${c.n} mm`)
console.log(`  empty 1 m vessel holds ${(c.fieldBytes / 1048576).toFixed(2)} MB of field`)

// a deposit with a large indigestible fraction must still be cleared away
const d = new Colony({ ...DEFAULT_PARAMS, grid: 64, maxMotes: 20000 }, { ...DEFAULT_ENV })
d.addFood('bacteria-lawn', 32, 4, 32, 80)
d.addFood('liver-puree', 40, 4, 32, 200)
d.inoculate(32, 4, 32, 300, 2.4)
let cleared = -1
for (let s = 0; s < (90 * 60) / FIXED_STEP_MIN; s++) {
  d.step(FIXED_STEP_MIN)
  if (d.foods.length < 2 && cleared < 0) cleared = d.timeMin / 60
}
const f0 = d.foods[0]
if (f0) {
  console.log(
    '   remaining pools mg:',
    Object.entries(f0.pools)
      .filter(([, v]) => (v as number) > 1e-3)
      .map(([k, v]) => `${k}=${(v as number).toFixed(3)}`)
      .join(' '),
    `colonisation=${f0.colonization.toFixed(2)}`,
  )
}
const st = d.buildStats()
console.log(
  `bacterial lawn cleared after ${cleared < 0 ? 'never' : cleared.toFixed(1) + ' h'};` +
    ` residue kept in ledger: ${st.residueMg.toFixed(2)} mg`,
)

// scatter onto whatever is highest in the column
const e = new Colony({ ...DEFAULT_PARAMS, grid: 96, maxMotes: 20000 }, { ...DEFAULT_ENV })
e.addSolid('platform', 'wood', 48, 0, 48, 1.6)
const top = e.solids[0].y + e.solids[0].hy
e.scatterFood('oat-flake', 60)
const onTop = e.foods.filter((f) => f.y > top).length
console.log(
  `scattered ${e.foods.length}, ${onTop} landed on the platform (top at ${top.toFixed(1)} mm),` +
    ` heights ${Math.min(...e.foods.map((f) => f.y)).toFixed(1)}-${Math.max(...e.foods.map((f) => f.y)).toFixed(1)} mm`,
)
