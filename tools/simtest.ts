/**
 * Headless harness: runs the colony without a browser so the biology can be
 * checked and timed. Build with `vite build --ssr tools/simtest.ts` and run the
 * emitted file with node.
 */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'
import { analyse, yieldPotential } from '../src/sim/foods'
import { FOODS } from '../src/sim/foods'
import { PRESET_BY_ID } from '../src/sim/presets'

function runScenario(presetId: string, hours: number, label: string) {
  const c = new Colony({ ...DEFAULT_PARAMS, grid: 64, maxMotes: 16000 }, { ...DEFAULT_ENV })
  const p = PRESET_BY_ID[presetId]
  if (p.env) c.setEnv(p.env)
  const n = c.n
  for (const f of p.foods) c.addFood(f.defId, f.at[0] * n, f.at[1] * n, f.at[2] * n, f.massMg)
  for (const i of p.inocula) c.inoculate(i.at[0] * n, i.at[1] * n, i.at[2] * n, i.motes ?? 220, 2)

  const steps = Math.round((hours * 60) / FIXED_STEP_MIN)
  const t0 = performance.now()
  let worstStep = 0
  for (let s = 0; s < steps; s++) {
    const a = performance.now()
    c.step(FIXED_STEP_MIN)
    const d = performance.now() - a
    if (d > worstStep) worstStep = d
    if (s % Math.round(steps / 6) === 0) {
      const st = c.buildStats()
      console.log(
        `  t=${(st.timeMin / 60).toFixed(1)}h motes=${String(st.motes).padStart(5)} dorm=${String(
          st.dormant,
        ).padStart(4)} biomass=${st.biomassMg.toFixed(3)}mg P:C=${
          isFinite(st.pcRatio) ? st.pcRatio.toFixed(2) : 'inf'
        } limiting=${st.limiting} carb=${(st.substrateCarbUg / 1000).toFixed(2)}mg prot=${(
          st.substrateProteinUg / 1000
        ).toFixed(2)}mg food=${st.foodRemainingMg.toFixed(0)}mg micro=${st.factors.micronutrient.toFixed(2)}`,
      )
    }
  }
  const ms = performance.now() - t0
  const st = c.buildStats()

  // NaN sweep across every mutable array.
  let bad = 0
  for (let i = 0; i < c.highWater; i++) {
    if (c.state[i] === 0) continue
    if (
      !isFinite(c.px[i]) ||
      !isFinite(c.py[i]) ||
      !isFinite(c.pz[i]) ||
      !isFinite(c.biomass[i]) ||
      !isFinite(c.cStore[i]) ||
      !isFinite(c.pStore[i]) ||
      c.px[i] < 0 ||
      c.px[i] > c.n
    )
      bad++
  }
  for (const f of [c.carb, c.prot, c.trail]) {
    for (let i = 0; i < f.data.length; i++) if (!isFinite(f.data[i])) bad++
  }

  console.log(
    `[${label}] ${steps} steps in ${ms.toFixed(0)}ms (${(ms / steps).toFixed(2)} ms/step, worst ${worstStep.toFixed(
      1,
    )}ms) | final biomass ${st.biomassMg.toFixed(3)}mg peak ${st.peakBiomassMg.toFixed(
      3,
    )} | motes ${st.motes} dormant ${st.dormant} | divisions ${st.divisions} deaths ${st.deaths} | yield ${(
      st.growthEfficiency * 100
    ).toFixed(0)}% | bad=${bad}`,
  )
  for (const d of st.diagnostics) console.log(`    - [${d.level}] ${d.text}`)
  console.log()
  return st
}

console.log('=== food table sanity ===')
for (const f of FOODS) {
  const sum = Object.values(f.comp).reduce((a, b) => a + b, 0)
  const a = analyse(f)
  const y = yieldPotential(f, f.defaultMassMg)
  const flag = Math.abs(sum - 100) > 0.6 ? '  <-- composition does not sum to 100' : ''
  console.log(
    `${f.id.padEnd(16)} sum=${sum.toFixed(2).padStart(6)} kcal=${a.grossKcal.toFixed(0).padStart(3)}/${a.digestibleKcal
      .toFixed(0)
      .padStart(3)} P:C=${(isFinite(a.pcRatio) ? a.pcRatio.toFixed(2) : 'inf').padStart(6)} C:N=${(isFinite(a.cnRatio)
      ? a.cnRatio.toFixed(1)
      : 'inf'
    ).padStart(6)} mOsm=${a.osmolarity.toFixed(0).padStart(5)} yield=${y.biomassMg
      .toFixed(2)
      .padStart(7)}mg limited-by=${y.limitedBy}${flag}`,
  )
}
console.log()

console.log('=== scenarios ===')
runScenario('optimum', 12, 'reference 2:1 medium')
runScenario('classic', 12, 'oat flakes')
runScenario('sugar-trap', 12, 'sugar trap')
runScenario('lawn', 12, 'bacterial lawn')
runScenario('cofactor', 12, 'haematin starvation')
runScenario('empty', 6, 'no food at all')
