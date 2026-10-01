/** The actual localStorage round trip, not just snapshot/restore. */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'

// A stand-in for the browser's, with the same 5 MB-ish behaviour.
const store = new Map<string, string>()
let quota = 5 * 1024 * 1024
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    let used = 0
    for (const [kk, vv] of store) if (kk !== k) used += vv.length
    if (used + v.length > quota) throw new Error('QuotaExceededError')
    store.set(k, v)
  },
  removeItem: (k: string) => void store.delete(k),
}

const { saveScene, loadScene } = await import('../src/state/persist')

const ui = {
  presetId: 'classic', selectedFoodId: 'oat-flake', placeMassMg: null, solidKindId: 'wall',
  solidMaterial: 'wood', solidDims: [6, 20, 2] as [number, number, number], solidRotated: false,
  solidClimbable: true, solidYaw: 0, wipeRadius: 6, brightness: 1, paletteId: 'ember',
  placementHeight: 4, panel: 'build', speed: 1, showNetwork: true, showVeins: true,
  showMotes: true, showPlane: true,
}

function scene(motes: number, solids: number) {
  const c = new Colony({ ...DEFAULT_PARAMS, grid: 96, maxMotes: motes }, { ...DEFAULT_ENV })
  for (let i = 0; i < solids; i++) {
    c.addSolid('wall', 'wood', 10 + i * 3, 2, 20 + (i % 5) * 7, 1, i % 2 === 0, [4, 14, 2], i % 3 !== 0, 0.4)
  }
  c.addFood('oat-flake', 48, 4, 48, 200)
  c.inoculate(48, 4, 48, 400, 3)
  for (let h = 0; h < 8; h++) for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
  return c
}

for (const [motes, solids] of [[20000, 6], [60000, 6], [150000, 40]] as [number, number][]) {
  store.clear()
  const c = scene(motes, solids)
  const before = c.buildStats()
  const ok = saveScene(c, ui)
  const bytes = store.get('goober.scene.v1')?.length ?? 0
  let restored = 'not attempted'
  if (ok) {
    const loaded = loadScene()
    if (!loaded) restored = 'LOAD FAILED'
    else {
      const d = new Colony({ ...DEFAULT_PARAMS, grid: 64 }, { ...DEFAULT_ENV })
      d.restore(loaded.snapshot)
      restored = `solids ${d.solids.length}/${c.solids.length}, foods ${d.foods.length}/${c.foods.length}, biomass ${d
        .buildStats()
        .biomassMg.toFixed(3)}/${before.biomassMg.toFixed(3)}`
    }
  }
  console.log(
    `maxMotes ${String(motes).padStart(6)} solids ${String(solids).padStart(2)} | live motes ${String(
      before.motes,
    ).padStart(5)} | save ${ok ? 'ok' : 'FAILED'} ${(bytes / 1048576).toFixed(2)} MB | ${restored}`,
  )
}
