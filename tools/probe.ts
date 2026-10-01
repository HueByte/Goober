import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'
import { PRESET_BY_ID } from '../src/sim/presets'

const c = new Colony({ ...DEFAULT_PARAMS, grid: 64, maxMotes: 16000 }, { ...DEFAULT_ENV })
const p = PRESET_BY_ID['optimum']
if (p.env) c.setEnv(p.env)
const n = c.n
for (const f of p.foods) c.addFood(f.defId, f.at[0] * n, f.at[1] * n, f.at[2] * n, f.massMg)
for (const i of p.inocula) c.inoculate(i.at[0] * n, i.at[1] * n, i.at[2] * n, i.motes ?? 220, 2)

function probe(tag: string) {
  let maxC = 0, maxP = 0
  for (let i = 0; i < c.carb.data.length; i++) { if (c.carb.data[i] > maxC) maxC = c.carb.data[i] }
  for (let i = 0; i < c.prot.data.length; i++) { if (c.prot.data[i] > maxP) maxP = c.prot.data[i] }
  const buckets = [0, 0, 0, 0, 0]
  let near = 0, sumDist = 0, alive = 0, sumBm = 0
  let cAtMote = 0, pAtMote = 0
  for (let i = 0; i < c.highWater; i++) {
    if (c.state[i] === 0) continue
    alive++
    sumBm += c.biomass[i]
    buckets[Math.min(4, Math.floor(c.satiety[i] * 5))]++
    let best = 1e9
    for (const f of c.foods) {
      const d = Math.hypot(f.x - c.px[i], f.y - c.py[i], f.z - c.pz[i])
      if (d < best) best = d
    }
    sumDist += best
    if (best < 4) near++
    cAtMote += c.carb.nearest(c.px[i], c.py[i], c.pz[i])
    pAtMote += c.prot.nearest(c.px[i], c.py[i], c.pz[i])
  }
  console.log(
    `${tag} t=${(c.timeMin / 60).toFixed(1)}h alive=${alive} bm/mote=${(sumBm / alive).toFixed(1)}ug ` +
      `peakC=${maxC.toFixed(0)} peakP=${maxP.toFixed(0)} ` +
      `atMote C=${(cAtMote / alive).toFixed(2)} P=${(pAtMote / alive).toFixed(2)} ` +
      `dist=${(sumDist / alive).toFixed(1)} near=${near} satiety=[${buckets.join(',')}]`,
  )
}

probe('start')
for (let h = 1; h <= 12; h++) {
  for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
  probe('     ')
}
