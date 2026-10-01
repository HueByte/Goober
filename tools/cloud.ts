/** How many points the renderer would actually emit for a matured colony. */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'
import { PRESET_BY_ID } from '../src/sim/presets'

const VEIN_REF = 130
const SLIME_REF = 60

function build(presetId: string) {
  const p = PRESET_BY_ID[presetId]
  const c = new Colony(
    { ...DEFAULT_PARAMS, grid: p.grid ?? 96, maxMotes: 45000 },
    { ...DEFAULT_ENV, ...(p.env ?? {}) },
  )
  const n = c.n
  for (const s of p.solids ?? [])
    c.addSolid(s.kindId, s.material ?? 'wood', s.at[0] * n, s.at[1] * n, s.at[2] * n, s.scale ?? 1, s.rotated ?? false)
  for (const f of p.foods) c.addFood(f.defId, f.at[0] * n, f.at[1] * n, f.at[2] * n, f.massMg)
  for (const i of p.inocula) c.inoculate(i.at[0] * n, i.at[1] * n, i.at[2] * n, i.motes ?? 240, 2.4)
  return c
}

for (const id of ['classic', 'maze', 'gel']) {
  const c = build(id)
  for (const hours of [3, 10, 24]) {
    while (c.timeMin < hours * 60) c.step(FIXED_STEP_MIN)
    let veinPts = 0
    let veinVox = 0
    let slimePts = 0
    let maxV = 0
    let maxT = 0
    const band = [0, 0, 0, 0, 0, 0]
    const vd = c.vein.data
    const td = c.trail.data
    for (let i = 0; i < vd.length; i++) {
      const v = vd[i]
      if (v > maxV) maxV = v
      if (v > 2) {
        veinVox++
        const q = Math.log1p(v / 3) / Math.log1p(420 / 3)
        veinPts += 1 + ((q * 6) | 0)
        band[Math.min(5, Math.floor(q * 6))]++
      }
      const s = td[i]
      if (s > maxT) maxT = s
      if (s > 5) slimePts++
    }
    const st = c.buildStats()
    console.log(
      `${id.padEnd(8)} ${String(hours).padStart(2)}h motes=${String(st.motes).padStart(5)} | vein ${String(
        veinVox,
      ).padStart(6)}vx -> ${String(veinPts).padStart(7)}pts (max ${maxV.toFixed(
        0,
      )}) | bands ${band.join('/')} | slime ${String(slimePts).padStart(6)}`,
    )
  }
}
