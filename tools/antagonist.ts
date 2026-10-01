/** Do non-nutritive deposits survive being placed? */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'
import { FOODS, foodMassMg } from '../src/sim/foods'

const c = new Colony({ ...DEFAULT_PARAMS, grid: 64, maxMotes: 8000 }, { ...DEFAULT_ENV })
for (const f of FOODS) c.addFood(f.id, 10 + (FOODS.indexOf(f) % 8) * 6, 4, 10 + ((FOODS.indexOf(f) / 8) | 0) * 6, 200)
console.log(`placed ${FOODS.length}, on the plate: ${c.foods.length}`)

const start = new Map(c.foods.map((f) => [f.defId, foodMassMg(f)]))
for (let h = 0; h < 6; h++) for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
console.log(`after one step and 6 h, still there: ${c.foods.length}`)
for (const def of FOODS) {
  const inst = c.foods.find((f) => f.defId === def.id)
  const was = start.get(def.id)
  console.log(
    `  ${def.id.padEnd(16)} ${def.category.padEnd(12)} ${
      inst ? `${foodMassMg(inst).toFixed(1).padStart(6)} mg left of ${was?.toFixed(0)}` : 'GONE'
    }`,
  )
}

// And the other half of the rule: food that has actually been eaten must still
// clear off the plate, and a dissolving crystal must eventually finish.
console.log('')
const d = new Colony({ ...DEFAULT_PARAMS, grid: 64, maxMotes: 20000 }, { ...DEFAULT_ENV })
d.addFood('bacteria-lawn', 32, 4, 32, 120)
d.addFood('oat-flake', 36, 4, 32, 200)
d.addFood('salt-crystal', 20, 4, 44, 60)
d.addFood('vinegar-drop', 44, 4, 44, 250)
d.inoculate(32, 4, 32, 300, 2.4)
for (let h = 0; h <= 72; h++) {
  for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) d.step(FIXED_STEP_MIN)
  if (h % 12 !== 0) continue
  console.log(
    `${String(h).padStart(3)}h ${d.foods
      .map((f) => `${f.defId}=${foodMassMg(f).toFixed(0)}mg`)
      .join('  ') || '(plate clear)'}`,
  )
}
