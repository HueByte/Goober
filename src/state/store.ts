import { create } from 'zustand'
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS } from '../sim/colony'
import { FOODS, FOOD_BY_ID, foodMassMg } from '../sim/foods'
import { PRESET_BY_ID, PRESETS } from '../sim/presets'
import { SOLID_KINDS, kindSize } from '../sim/solids'
import type { Material, SolidInstance } from '../sim/solids'
import type { ColonyStats, EnvParams, SimParams } from '../sim/types'
import { clearScene, hasSavedScene, loadScene, saveScene } from './persist'
import type { SavedUi } from './persist'

/** The simulation lives outside React: no re-render is ever triggered by a step. */
export const colony = new Colony(DEFAULT_PARAMS, DEFAULT_ENV)

/** Simulated time of the next automatic scatter. Not state: nothing renders it. */
let nextAutoFeedAt = 0

export type Tool = 'feed' | 'build' | 'inoculate' | 'erase' | 'wipe'
/**
 * What a random scatter draws from. "assorted" is everything edible; "chaotic"
 * is the whole larder, antagonists included, which is what an uncontrolled
 * surface actually offers an organism - most of it food, some of it a crystal
 * of salt.
 */
export type ScatterSource = 'selected' | 'assorted' | 'chaotic'

const EDIBLE = FOODS.filter((f) => f.category !== 'antagonist').map((f) => f.id)
const HARMFUL = FOODS.filter((f) => f.category === 'antagonist').map((f) => f.id)
/** Three edible entries per antagonist, so a chaotic scatter still feeds. */
const CHAOTIC = [...EDIBLE, ...EDIBLE, ...EDIBLE, ...HARMFUL]

function scatterPool(source: ScatterSource, selectedFoodId: string): string[] {
  if (source === 'assorted') return EDIBLE
  if (source === 'chaotic') return CHAOTIC
  return [selectedFoodId]
}
export type Panel = 'food' | 'build' | 'environment' | 'colony' | 'about'

export interface FoodMarker {
  id: string
  defId: string
  x: number
  y: number
  z: number
  massMg: number
  initialMassMg: number
  colonization: number
}

interface Perf {
  fps: number
  stepMs: number
  substeps: number
}

interface State {
  params: SimParams
  env: EnvParams
  tool: Tool
  selectedFoodId: string
  placeMassMg: number | null
  placementHeight: number
  solidKindId: string
  solidMaterial: Material
  /** Full dimensions of the next object, in millimetres. */
  solidDims: [number, number, number]
  solidRotated: boolean
  solidClimbable: boolean
  /** Yaw of the next object, in radians. */
  solidYaw: number
  /** Hides every panel and disables placing, leaving only the view. */
  uiHidden: boolean
  /** Radius of the wipe brush, in millimetres. */
  wipeRadius: number
  /** View-only light level. Nothing to do with the phototaxis lamp. */
  brightness: number
  /** Colour scheme for the organism. */
  paletteId: string
  paused: boolean
  speed: number
  stats: ColonyStats | null
  markers: FoodMarker[]
  solids: SolidInstance[]
  inspectedInstanceId: string | null
  presetId: string
  showNetwork: boolean
  showVeins: boolean
  showMotes: boolean
  showPlane: boolean
  panel: Panel
  perf: Perf

  setParam: <K extends keyof SimParams>(key: K, value: SimParams[K]) => void
  setEnvValue: <K extends keyof EnvParams>(key: K, value: EnvParams[K]) => void
  setTool: (t: Tool) => void
  selectFood: (id: string) => void
  selectSolid: (kindId: string) => void
  setSolidMaterial: (m: Material) => void
  setSolidDim: (axis: 0 | 1 | 2, value: number) => void
  resetSolidDims: () => void
  toggleSolidRotated: () => void
  toggleSolidClimbable: () => void
  rotateSolid: (delta: number) => void
  setSolidYaw: (yaw: number) => void
  toggleUi: () => void
  setWipeRadius: (r: number) => void
  setBrightness: (b: number) => void
  setPalette: (id: string) => void
  clearMould: () => void
  scatterFood: (count: number, pad?: number) => void
  /** What a random scatter draws from. */
  scatterSource: ScatterSource
  setScatterSource: (s: ScatterSource) => void
  /** Drop a scatter automatically every so often, so the colony keeps moving. */
  autoFeed: boolean
  toggleAutoFeed: () => void
  /** Simulated hours between automatic drops. */
  autoFeedHours: number
  setAutoFeedHours: (h: number) => void
  /** How far beyond the colony's own footprint automatic drops may land, in mm. */
  autoFeedReach: number
  setAutoFeedReach: (mm: number) => void
  /** Called from the render loop; drops a scatter when one is due. */
  tickAutoFeed: () => void
  scatterCount: number
  setScatterCount: (n: number) => void
  /** Scatter only enough to cover upkeep, rather than an arbitrary mass. */
  scatterRation: boolean
  toggleScatterRation: () => void
  scatterHours: number
  setScatterHours: (h: number) => void
  setPlaceMass: (mg: number | null) => void
  setPlacementHeight: (h: number) => void
  togglePaused: () => void
  setSpeed: (s: number) => void
  setPanel: (p: Panel) => void
  toggleNetwork: () => void
  toggleVeins: () => void
  toggleMotes: () => void
  togglePlane: () => void
  inspect: (id: string | null) => void

  placeAt: (x: number, y: number, z: number) => void
  eraseAt: (x: number, y: number, z: number) => void
  clearSolids: () => void
  loadPreset: (id: string) => void
  refresh: (perf: Partial<Perf>) => void
  saveNow: () => void
  forgetSaved: () => void
  savedAt: number | null
}

function markersOf(c: Colony): FoodMarker[] {
  return c.foods.map((f) => ({
    id: f.id,
    defId: f.defId,
    x: f.x,
    y: f.y,
    z: f.z,
    massMg: foodMassMg(f),
    initialMassMg: f.initialMassMg,
    colonization: f.colonization,
  }))
}

export const useStore = create<State>((set, get) => ({
  params: { ...DEFAULT_PARAMS },
  env: { ...DEFAULT_ENV },
  tool: 'feed',
  selectedFoodId: FOODS[0].id,
  placeMassMg: null,
  placementHeight: 4,
  solidKindId: SOLID_KINDS[0].id,
  solidMaterial: 'plastic',
  solidDims: kindSize(SOLID_KINDS[0].id),
  solidRotated: false,
  // New objects are sheer by default. A wall people place is nearly always
  // meant to be a constraint, and a plasmodium climbs anything it can grip - so
  // the climbable default made every barrier leak over the top, which is
  // correct behaviour and a surprising answer to "I built a wall".
  solidClimbable: false,
  solidYaw: 0,
  uiHidden: false,
  wipeRadius: 8,
  brightness: 1,
  paletteId: 'gold',
  scatterCount: 8,
  scatterSource: 'selected' as ScatterSource,
  autoFeed: false,
  autoFeedHours: 6,
  autoFeedReach: 30,
  scatterRation: true,
  scatterHours: 8,
  paused: false,
  speed: 1,
  stats: null,
  markers: [],
  solids: [],
  inspectedInstanceId: null,
  presetId: 'empty',
  showNetwork: true,
  showVeins: true,
  showMotes: true,
  showPlane: true,
  panel: 'food',
  perf: { fps: 0, stepMs: 0, substeps: 0 },
  savedAt: null,

  setParam: (key, value) => {
    colony.setParams({ [key]: value } as Partial<SimParams>)
    set({ params: { ...colony.params }, solids: [...colony.solids] })
    if (key === 'grid') set({ placementHeight: colony.env.gravity > 0 ? 4 : colony.n / 2 })
    if (key === 'maxMotes') set({ markers: markersOf(colony), solids: [...colony.solids] })
  },
  setEnvValue: (key, value) => {
    colony.setEnv({ [key]: value } as Partial<EnvParams>)
    set({ env: { ...colony.env } })
  },
  setTool: (tool) => set({ tool }),
  selectFood: (selectedFoodId) => set({ selectedFoodId, tool: 'feed', placeMassMg: null }),
  selectSolid: (solidKindId) =>
    set({ solidKindId, tool: 'build', solidDims: kindSize(solidKindId) }),
  setSolidMaterial: (solidMaterial) => set({ solidMaterial }),
  setSolidDim: (axis, value) =>
    set((s) => {
      const dims: [number, number, number] = [...s.solidDims]
      dims[axis] = value
      return { solidDims: dims }
    }),
  resetSolidDims: () => set((s) => ({ solidDims: kindSize(s.solidKindId) })),
  toggleSolidRotated: () => set((s) => ({ solidRotated: !s.solidRotated })),
  toggleSolidClimbable: () => set((s) => ({ solidClimbable: !s.solidClimbable })),
  rotateSolid: (delta) => set((s) => ({ solidYaw: s.solidYaw + delta })),
  setSolidYaw: (solidYaw) => set({ solidYaw }),
  toggleUi: () => set((s) => ({ uiHidden: !s.uiHidden })),
  setWipeRadius: (wipeRadius) => set({ wipeRadius }),
  setBrightness: (brightness) => set({ brightness }),
  setPalette: (paletteId) => set({ paletteId }),
  clearMould: () => {
    colony.clearMould()
    set({ stats: colony.buildStats() })
  },

  setScatterCount: (scatterCount) => set({ scatterCount }),
  setScatterSource: (scatterSource) => set({ scatterSource }),
  setAutoFeedHours: (autoFeedHours) => set({ autoFeedHours }),
  setAutoFeedReach: (autoFeedReach) => set({ autoFeedReach }),
  toggleAutoFeed: () =>
    set((s) => {
      // Start the clock from now, so switching it on does not immediately dump
      // a scatter because the colony happens to be eight hours old.
      nextAutoFeedAt = colony.timeMin + s.autoFeedHours * 60
      return { autoFeed: !s.autoFeed }
    }),

  /**
   * The drip feed.
   *
   * Timed in simulated minutes rather than real seconds, so it keeps the same
   * meaning whatever the clock is set to: "a scatter every six hours" is a
   * statement about the organism's life, not about how long you were watching.
   */
  tickAutoFeed: () => {
    const s = get()
    if (!s.autoFeed || s.paused) return
    if (colony.timeMin < nextAutoFeedAt) return
    nextAutoFeedAt = colony.timeMin + Math.max(0.1, s.autoFeedHours) * 60
    const pool = scatterPool(s.scatterSource, s.selectedFoodId)
    colony.scatterBeyond(pool, s.scatterCount, s.autoFeedReach, (id) => {
      if (!s.scatterRation) return s.placeMassMg ?? FOOD_BY_ID[id].defaultMassMg
      const share = colony.rationMassMg(id, s.scatterHours) / Math.max(1, s.scatterCount)
      return share > 0.01 ? Math.max(6, share) : FOOD_BY_ID[id].defaultMassMg
    })
    set({ markers: markersOf(colony), stats: colony.buildStats() })
  },

  setScatterHours: (scatterHours) => set({ scatterHours }),
  toggleScatterRation: () => set((s) => ({ scatterRation: !s.scatterRation })),

  scatterFood: (count, pad) => {
    const { selectedFoodId, placeMassMg, scatterRation, scatterHours, scatterSource } = get()
    const pool = scatterPool(scatterSource, selectedFoodId)
    colony.scatterFood(
      pool,
      count,
      (id) => {
        if (!scatterRation) return placeMassMg ?? FOOD_BY_ID[id].defaultMassMg
        // Every food has its own yield, so the upkeep ration is worked out per
        // deposit rather than once for the whole scatter. Anything with no yield
        // at all - a salt crystal, a quinine crystal - has no ration to compute,
        // so it goes down at its own default mass.
        const share = colony.rationMassMg(id, scatterHours) / Math.max(1, count)
        return share > 0.01 ? Math.max(6, share) : FOOD_BY_ID[id].defaultMassMg
      },
      pad,
    )
    set({ markers: markersOf(colony), stats: colony.buildStats() })
  },
  setPlaceMass: (placeMassMg) => set({ placeMassMg }),
  setPlacementHeight: (placementHeight) => set({ placementHeight }),
  togglePaused: () => set((s) => ({ paused: !s.paused })),
  setSpeed: (speed) => set({ speed }),
  setPanel: (panel) => set({ panel }),
  toggleNetwork: () => set((s) => ({ showNetwork: !s.showNetwork })),
  toggleVeins: () => set((s) => ({ showVeins: !s.showVeins })),
  toggleMotes: () => set((s) => ({ showMotes: !s.showMotes })),
  togglePlane: () => set((s) => ({ showPlane: !s.showPlane })),
  inspect: (inspectedInstanceId) => set({ inspectedInstanceId }),

  placeAt: (x, y, z) => {
    const {
      tool,
      uiHidden,
      selectedFoodId,
      placeMassMg,
      solidKindId,
      solidMaterial,
      solidDims,
      solidRotated,
      solidClimbable,
      solidYaw,
    } = get()
    // With the interface hidden the pointer is only for looking around.
    if (uiHidden) return
    if (tool === 'wipe') {
      colony.wipeMould(x, y, z, get().wipeRadius)
      set({ stats: colony.buildStats() })
      return
    }
    if (tool === 'inoculate') {
      colony.inoculate(x, y, z, 200, 2)
    } else if (tool === 'build') {
      colony.addSolid(
        solidKindId,
        solidMaterial,
        x,
        y,
        z,
        1,
        solidRotated,
        solidDims,
        solidClimbable,
        solidYaw,
      )
    } else if (tool === 'erase') {
      get().eraseAt(x, y, z)
      return
    } else {
      const def = FOOD_BY_ID[selectedFoodId]
      const f = colony.addFood(selectedFoodId, x, y, z, placeMassMg ?? def.defaultMassMg)
      if (f) set({ inspectedInstanceId: f.id })
    }
    set({ markers: markersOf(colony), solids: [...colony.solids] })
  },

  eraseAt: (x, y, z) => {
    // Whatever is closest to the click: a deposit, or a solid.
    const f = colony.pickFood(x, y, z, 6)
    const s = colony.pickSolid(x, y, z, 6)
    if (f && s) {
      const df = (f.x - x) ** 2 + (f.y - y) ** 2 + (f.z - z) ** 2
      const inside = colony.isSolid(x, y, z)
      if (inside || df > 16) colony.removeSolid(s.id)
      else colony.removeFood(f.id)
    } else if (f) colony.removeFood(f.id)
    else if (s) colony.removeSolid(s.id)
    set({ markers: markersOf(colony), solids: [...colony.solids] })
  },

  clearSolids: () => {
    for (const s of [...colony.solids]) colony.removeSolid(s.id)
    set({ solids: [] })
  },

  loadPreset: (id) => {
    const preset = PRESET_BY_ID[id] ?? PRESETS[0]
    colony.reset()
    if (preset.grid && preset.grid !== colony.params.grid) colony.setParams({ grid: preset.grid })
    if (preset.params) colony.setParams(preset.params)
    colony.setEnv({ ...DEFAULT_ENV, ...(preset.env ?? {}) })
    const n = colony.n
    for (const s of preset.solids ?? []) {
      colony.addSolid(
        s.kindId,
        s.material ?? 'wood',
        s.at[0] * n,
        s.at[1] * n,
        s.at[2] * n,
        s.scale ?? 1,
        s.rotated ?? false,
        undefined,
        s.climbable ?? true,
        0,
      )
    }
    for (const f of preset.foods) {
      colony.addFood(f.defId, f.at[0] * n, f.at[1] * n, f.at[2] * n, f.massMg)
    }
    for (const i of preset.inocula) {
      colony.inoculate(i.at[0] * n, i.at[1] * n, i.at[2] * n, i.motes ?? 240, 2.4)
    }
    set({
      presetId: id,
      params: { ...colony.params },
      env: { ...colony.env },
      markers: markersOf(colony),
      solids: [...colony.solids],
      stats: colony.buildStats(),
      inspectedInstanceId: null,
      paused: false,
      placementHeight: colony.env.gravity > 0 ? 4 : colony.n / 2,
    })
  },

  refresh: (perf) =>
    set((s) => ({
      stats: colony.buildStats(),
      markers: markersOf(colony),
      perf: { ...s.perf, ...perf },
    })),

  saveNow: () => {
    if (saveScene(colony, uiOf(get()))) set({ savedAt: Date.now() })
  },

  forgetSaved: () => {
    clearScene()
    set({ savedAt: null })
  },
}))

/** The slice of interface state worth carrying across a reload. */
function uiOf(s: State): SavedUi {
  return {
    presetId: s.presetId,
    selectedFoodId: s.selectedFoodId,
    placeMassMg: s.placeMassMg,
    solidKindId: s.solidKindId,
    solidMaterial: s.solidMaterial,
    solidDims: s.solidDims,
    solidRotated: s.solidRotated,
    solidClimbable: s.solidClimbable,
    solidYaw: s.solidYaw,
    wipeRadius: s.wipeRadius,
    brightness: s.brightness,
    paletteId: s.paletteId,
    placementHeight: s.placementHeight,
    panel: s.panel,
    speed: s.speed,
    showNetwork: s.showNetwork,
    showVeins: s.showVeins,
    showMotes: s.showMotes,
    showPlane: s.showPlane,
  }
}

// Pick up where the last session left off, if there is one.
function boot() {
  const saved = hasSavedScene() ? loadScene() : null
  if (!saved) {
    // Blank vessel: the scenarios are in the menu when they are wanted.
    useStore.getState().loadPreset('empty')
    return
  }
  try {
    colony.restore(saved.snapshot)
    const ui = saved.ui
    useStore.setState({
      params: { ...colony.params },
      env: { ...colony.env },
      presetId: ui.presetId,
      selectedFoodId: ui.selectedFoodId,
      placeMassMg: ui.placeMassMg,
      solidKindId: ui.solidKindId,
      solidMaterial: ui.solidMaterial as State['solidMaterial'],
      solidDims: ui.solidDims,
      solidRotated: ui.solidRotated,
      solidClimbable: ui.solidClimbable,
      solidYaw: ui.solidYaw,
      wipeRadius: ui.wipeRadius,
      brightness: ui.brightness ?? 1,
      paletteId: ui.paletteId ?? 'gold',
      placementHeight: ui.placementHeight,
      panel: ui.panel as State['panel'],
      speed: ui.speed,
      showNetwork: ui.showNetwork,
      showVeins: ui.showVeins,
      showMotes: ui.showMotes,
      showPlane: ui.showPlane,
      markers: markersOf(colony),
      solids: [...colony.solids],
      stats: colony.buildStats(),
      savedAt: Date.now(),
    })
  } catch {
    // A save from an incompatible build is not worth dying over.
    clearScene()
    useStore.getState().loadPreset('empty')
  }
}

boot()

if (typeof window !== 'undefined') {
  // Autosave.
  //
  // It used to skip while the clock was stopped, which meant the one thing
  // people most expect to survive a reload - a map they paused to build - was
  // the one thing that never got saved. So it watches the vessel's revision
  // instead: if anything has been placed, removed or seeded since the last
  // save, it writes, running or not. An unchanged scene costs nothing.
  let savedRevision = -1
  let savedAtMin = -1
  window.setInterval(() => {
    const s = useStore.getState()
    const changed = colony.revision !== savedRevision
    // While it is running the swarm itself is worth re-saving now and then,
    // even with nothing placed.
    const moved = !s.paused && colony.timeMin - savedAtMin > 1
    if (!changed && !moved) return
    savedRevision = colony.revision
    savedAtMin = colony.timeMin
    s.saveNow()
  }, 5000)
  window.addEventListener('beforeunload', () => useStore.getState().saveNow())
}
