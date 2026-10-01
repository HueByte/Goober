/**
 * The colony: a Physarum-style agent simulation coupled to substrate chemistry.
 *
 * Each "mote" is a coarse-grained packet of plasmodium with its own position,
 * heading, biomass and two internal nutrient stores. Motes sense the substrate
 * ahead of them, steer up the gradient they currently need most, lay down slime
 * (which is itself an attractant, so tubes reinforce themselves), take up
 * nutrient with Michaelis-Menten kinetics, pay maintenance, grow, divide,
 * encyst when starved, and die.
 *
 * Food is not eaten directly. A deposit is digested extracellularly: enzymes are
 * only secreted where the plasmodium has actually spread, each macronutrient pool
 * is gated by the enzyme that cleaves it, and the products diffuse through the
 * agar as two currencies - carbon-equivalent and protein-equivalent.
 */
import {
  BIO,
  ENZYMES,
  MACRO_YIELD,
  MATRIX,
  TRACE_LABEL,
  balanceFactor,
  clamp,
  enzymeFor,
  heatDamagePerMin,
  humidityFactor,
  michaelis,
  motilityFactor,
  osmoticDamagePerMin,
  osmoticFactor,
  pcRatioFromFraction,
  phFactor,
  saturate,
  temperatureFactor,
} from './biology'
import { EnvGrid } from './env'
import { Field3D, depositSphere } from './field'
import type { FieldRegion, Obstacles } from './field'
import {
  MATERIALS,
  createSolid,
  solidBounds,
  solidContains,
  solidTopAt,
} from './solids'
import type { Material, SolidInstance } from './solids'
import {
  FOOD_BY_ID,
  NUTRITIVE_MACROS,
  analyse,
  createFoodInstance,
  foodMassMg,
  foodResidueMg,
} from './foods'
import type {
  ColonyStats,
  Diagnostic,
  EnvParams,
  FoodInstance,
  SimParams,
  TraceId,
  TraceStatus,
} from './types'

/** Fixed integration step, in simulated minutes. */
export const FIXED_STEP_MIN = 0.25

export const DEFAULT_PARAMS: SimParams = {
  grid: 96,
  maxMotes: 45000,
  minutesPerSecond: 20,
  sensorDistance: 1.7,
  sensorAngle: 0.35,
  sensorCount: 5,
  sensorStride: 1,
  turnRate: 0.85,
  // The advancing front of a plasmodium moves millimetres per hour, not
  // centimetres. Set this too high and the organism outruns its own food: it
  // sprints past a deposit before it can colonise it, never gets a body
  // together, and starves on top of a full plate.
  speed: 0.12,
  randomness: 0.16,
  depositRate: 6,
  trailDecayPerMin: 0.035,
  trailDiffusion: 0.12,
  veinDecayPerMin: 0.0012,
  // One voxel is 1 mm and one step is 0.25 min, so a mixing coefficient m is a
  // diffusion coefficient of m/6/0.25 mm^2/min. Glucose in dilute agar is about
  // 0.04 mm^2/min (6.7e-6 cm^2/s), which is m = 0.06.
  nutrientDiffusion: 0.06,
  nutrientDecayPerMin: 0.0004,
  trailAffinity: 1.35,
  nutrientAffinity: 2.6,
  repellentAversion: 3.2,
  surfaceAffinity: 1.6,
  cohesion: 3.2,
  circulation: 0.35,
}

export const DEFAULT_ENV: EnvParams = {
  temperatureC: 25,
  relativeHumidity: 95,
  substratePh: 5.6,
  substrateOsmolarity: 60,
  illumination: 0.05,
  agarPercent: 1.5,
  gravity: 0.4,
}

const STATE_FREE = 0
const STATE_ACTIVE = 1
const STATE_DORMANT = 2

/** Fraction of a colonised pool mobilised per minute at full enzyme capability. */
const ENZYME_RATE = 0.0025
/** Biomass density (ug per voxel) at which enzyme secretion is half-maximal. */
const COLONISATION_KM = 45
/**
 * Biomass density, ug per voxel, at which the body reads as half "solid". One
 * mote is about 10 ug, so this is set so that a single neighbour already counts
 * as being attached to something.
 */
const COHESION_KM = 7
/** Tube thickness at which streaming through it is half its maximum. */
const CONDUCTANCE_KM = 40
/** Store level the circulation equalises towards, as a fraction of capacity. */
const CIRCULATION_TARGET = 0.6
/** Biomass density above which the body is too crowded to thicken further. */
const CROWDING_LIMIT = 150
/**
 * Biomass that has to be around a mote, besides itself, for it to count as part
 * of the organism. A plasmodium is one cell: a single nucleus that has wandered
 * off is not a colony and cannot start one. Without this, a stray mote lands on a
 * deposit the body has not reached yet, feeds, divides, and a satellite blob
 * appears out of nowhere - which robs the whole thing of the moment where the
 * front actually arrives.
 */
const CONNECTION_FLOOR = 11
/** Substrate concentration at which a mote is half as excited as it can get. */
const EXCITE_KM = 2.5
/** Repellent load that counts as outright alarming. */
const FEAR_AT = 0.5
/** How hard a frightened mote steers away from the worst of it. */
const FLEE_WEIGHT = 1.4
/** Scales the repellent and light terms onto the same footing as sqrt(concentration). */
const REPEL_SCALE = 16
const LIGHT_SCALE = 5
/**
 * Half-saturation of the slime-following term, and its weight. Trail attraction
 * deliberately saturates: inside a thick mat every direction smells equally of
 * slime, so the colony spreads instead of collapsing back onto itself, while a
 * thin tube out in open agar is still worth following.
 */
const TRAIL_KM = 40
const TRAIL_WEIGHT = 3
/** Enzyme secretion that reaches a deposit even before the plasmodium arrives. */
const BASAL_SECRETION = 0.12
/** Slime density at which a strand can hold half of its own maximum load. */
const HOLD_KM = 55
/** Load a thick slime tube can carry on its own, with no surface to grip. */
const SLIME_HOLD = 1.25
/**
 * Adhesion carries a good deal more than the plasmodium's own weight, which is
 * why it climbs the wall of a Petri dish without difficulty. Scaling grip by this
 * means wood and paper are comfortable to climb, plastic is work, and glass and
 * steel let the front slide back down.
 */
const GRIP_STRENGTH = 1.7
/** How hard unsupported weight pulls the heading downwards. */
const GRAVITY_STEER = 0.55
/** Sag acceleration, voxels per minute squared, and the terminal sag rate. */
const SAG_ACCEL = 2.4
const SAG_MAX = 7
/** Fraction of the slime tube destroyed per minute while a span is collapsing. */
const TEAR_RATE = 0.5
/** Margin the active region keeps around anything that can hold substrate. */
const REGION_MARGIN = 4
/**
 * Transport-tube dynamics, after the adaptive-network model: a tube thickens in
 * proportion to the cytoplasmic flux through it and is reabsorbed when idle, so
 * the network prunes itself down to the routes that are actually carrying food.
 */
const VEIN_GAIN = 16
const VEIN_FLUX_KM = 9
const VEIN_MAX = 420
/** Tube thickness that counts as a real vein for the read-outs. */
const VEIN_VISIBLE = 8
/** Surplus store voided per minute when one currency is at capacity. */
const OVERFLOW_VOID_PER_MIN = 0.05
/** Resolution of the environmental chemistry grid. */
const ENV_GRID = 20
/**
 * Hard ceiling on the vessel, in voxels. Five fields plus two masks, and the
 * three diffusible fields need a scratch buffer each, so a vessel costs about
 * 36 bytes per voxel: 2.4 M voxels is ~85 MB, which is about as much as is
 * reasonable to ask of a browser tab. Beyond this the allocation is what fails,
 * not the simulation, and a failed allocation takes the whole page with it.
 */
export const MAX_VOXELS = 2_460_375 // 135^3
/** Bytes of field storage per voxel, for the read-out. */
export const BYTES_PER_VOXEL = 36

/** The largest vessel edge that fits inside the voxel ceiling. */
export function maxGridSize(): number {
  return Math.floor(Math.cbrt(MAX_VOXELS) / 8) * 8
}
/**
 * Diffusion and the biomass map both run on a coarser cadence than the swarm.
 * Diffusion is linear, so accumulating several steps' worth and applying a
 * proportionally larger mixing coefficient transports the same material for a
 * fraction of the work.
 */
const DIFFUSE_EVERY = 2
const BIO_MAP_EVERY = 8

const TRACE_IDS: TraceId[] = ['K', 'P', 'Mg', 'Ca', 'Na', 'Fe', 'Zn', 'thiamine', 'heme']

const zeroTraces = (): Record<TraceId, number> =>
  ({ K: 0, P: 0, Mg: 0, Ca: 0, Na: 0, Fe: 0, Zn: 0, thiamine: 0, heme: 0 })

export interface ColonySnapshot {
  version: number
  grid: number
  timeMin: number
  params: SimParams
  env: EnvParams
  solids: SolidInstance[]
  foods: FoodInstance[]
  tracePool: Record<TraceId, number>
  ledger: Record<string, number>
  moteCount: number
  moteData: Float32Array
  moteState: Uint8Array
}

export interface StepReport {
  substeps: number
  simMinutes: number
}

export class Colony {
  params: SimParams
  env: EnvParams

  n: number
  carb: Field3D
  prot: Field3D
  trail: Field3D
  /** Persistent transport tubes: thickness, not concentration. */
  vein: Field3D
  bio: Field3D
  envGrid: EnvGrid

  foods: FoodInstance[] = []
  solids: SolidInstance[] = []
  /** 1 where a solid occupies the voxel. */
  solidMask: Uint8Array
  /** Adhesion available at this voxel, 0..255, from any solid within one voxel. */
  gripField: Uint8Array
  /** 1 beside a sheer object: no purchase, and no way up. */
  slipField: Uint8Array
  /** Steps taken, used to stagger per-mote work across the swarm. */
  private stepCount = 0
  private compactAt = 0
  private pendingDiffusionMin = 0
  private obstacles: Obstacles | undefined
  private region: FieldRegion
  timeMin = 0

  // --- mote arrays (public: the renderer reads them directly) ---
  px!: Float32Array
  py!: Float32Array
  pz!: Float32Array
  dx!: Float32Array
  dy!: Float32Array
  dz!: Float32Array
  biomass!: Float32Array
  cStore!: Float32Array
  pStore!: Float32Array
  satiety!: Float32Array
  /** Sag velocity, voxels per minute. Negative is downwards. */
  vy!: Float32Array
  /**
   * Arousal, -1 to 1. Positive is a mote that has caught a strong smell of food
   * and is driving towards it; negative is one in something it wants out of.
   * Smoothed, so the swarm reads as having momentum rather than twitching.
   */
  mood!: Float32Array
  /**
   * Individual variation, 0..1. Without it every mote gives up its search at the
   * same distance and turns back at the same moment, and the colony leaves a
   * perfect circle behind it. Real plasmodium is not made of identical clones.
   */
  private trait!: Float32Array
  state!: Uint8Array
  private starveMin!: Float32Array
  private dormantMin!: Float32Array
  private freeSlots!: Int32Array
  private freeTop = 0
  highWater = 0
  motes = 0
  dormantCount = 0

  tracePool: Record<TraceId, number> = zeroTraces()
  private traceDemandRate: Record<TraceId, number> = zeroTraces()
  private traceSufficiency: Record<TraceId, number> = zeroTraces()
  private microFactor = 1

  // --- ledger ---
  intakeCarb = 0
  intakeProtein = 0
  voidedCarb = 0
  voidedProtein = 0
  biomassMadeUg = 0
  substrateUsedUg = 0
  divisions = 0
  deaths = 0
  peakBiomassMg = 0
  mobilisedMg = 0
  tears = 0
  /** Cytoplasm in transit through the tube network, shared by the whole body. */
  circulatingCarb = 0
  circulatingProtein = 0
  /** Indigestible mass left behind by deposits that have been cleared away. */
  spentResidueMg = 0
  /** Biomass broken down this step, whose minerals go back into the pool. */
  private recycleUg = 0
  private adheredCount = 0
  private airborneCount = 0

  private fillCarb = 0
  private fillProt = 0
  private meanPh = 0
  private meanOsmo = 0
  private meanToxin = 0
  private envDirty = true
  private envRebuiltAt = -1e9
  private lastStatsTime = 0
  private lastStatsBiomass = 0
  private growthRateEma = 0
  private sinCos: Float32Array = new Float32Array(0)
  private scratchNormal: number[] = [0, 1, 0]

  constructor(params: SimParams = DEFAULT_PARAMS, env: EnvParams = DEFAULT_ENV) {
    this.params = { ...params }
    this.env = { ...env }
    this.n = this.params.grid
    this.carb = new Field3D(this.n)
    this.prot = new Field3D(this.n)
    this.trail = new Field3D(this.n)
    this.vein = new Field3D(this.n, this.n, false)
    this.bio = new Field3D(this.n, this.n, false)
    this.envGrid = new EnvGrid(ENV_GRID, this.n)
    this.solidMask = new Uint8Array(this.n ** 3)
    this.gripField = new Uint8Array(this.n ** 3)
    this.slipField = new Uint8Array(this.n ** 3)
    this.region = { x0: 1, y0: 1, z0: 1, x1: 1, y1: 1, z1: 1 }
    this.allocate(this.params.maxMotes)
    this.rebuildSensorTable()
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  /** Field storage for the current vessel size. Throws if it will not fit. */
  private allocateFields(): void {
    const n = this.n
    this.carb = new Field3D(n)
    this.prot = new Field3D(n)
    this.trail = new Field3D(n)
    this.vein = new Field3D(n, n, false)
    this.bio = new Field3D(n, n, false)
    this.envGrid = new EnvGrid(ENV_GRID, n)
    this.solidMask = new Uint8Array(n ** 3)
    this.gripField = new Uint8Array(n ** 3)
    this.slipField = new Uint8Array(n ** 3)
  }

  private allocate(cap: number): void {
    this.px = new Float32Array(cap)
    this.py = new Float32Array(cap)
    this.pz = new Float32Array(cap)
    this.dx = new Float32Array(cap)
    this.dy = new Float32Array(cap)
    this.dz = new Float32Array(cap)
    this.biomass = new Float32Array(cap)
    this.cStore = new Float32Array(cap)
    this.pStore = new Float32Array(cap)
    this.satiety = new Float32Array(cap)
    this.vy = new Float32Array(cap)
    this.mood = new Float32Array(cap)
    this.trait = new Float32Array(cap)
    this.state = new Uint8Array(cap)
    this.starveMin = new Float32Array(cap)
    this.dormantMin = new Float32Array(cap)
    this.freeSlots = new Int32Array(cap)
    this.freeTop = 0
    this.highWater = 0
    this.motes = 0
    this.dormantCount = 0
  }

  get capacity(): number {
    return this.px.length
  }

  /**
   * The part of the lattice that can hold anything. Everything outside is
   * provably zero, so scans can skip it.
   */
  get activeRegion(): FieldRegion {
    return this.region
  }

  /**
   * Gather the living motes into a contiguous block, ordered by the voxel they
   * occupy.
   *
   * Two wins, both standard for large particle systems: the update loop stops
   * stepping over dead slots, and motes that read neighbouring field memory end
   * up next to each other, so the sensor samples hit cache instead of jumping
   * around a multi-megabyte array.
   */
  private compact(): void {
    const alive: number[] = []
    for (let i = 0; i < this.highWater; i++) if (this.state[i] !== STATE_FREE) alive.push(i)
    const n = this.n
    const key = new Float64Array(this.capacity)
    for (const i of alive) {
      key[i] =
        Math.floor(this.px[i]) + n * (Math.floor(this.py[i]) + n * Math.floor(this.pz[i]))
    }
    alive.sort((a, b) => key[a] - key[b])

    const count = alive.length
    const f32 = new Float32Array(count)
    const permuteF = (src: Float32Array) => {
      for (let k = 0; k < count; k++) f32[k] = src[alive[k]]
      src.set(f32.subarray(0, count), 0)
    }
    permuteF(this.px)
    permuteF(this.py)
    permuteF(this.pz)
    permuteF(this.dx)
    permuteF(this.dy)
    permuteF(this.dz)
    permuteF(this.biomass)
    permuteF(this.cStore)
    permuteF(this.pStore)
    permuteF(this.satiety)
    permuteF(this.vy)
    permuteF(this.mood)
    permuteF(this.trait)
    permuteF(this.starveMin)
    permuteF(this.dormantMin)
    const u8 = new Uint8Array(count)
    for (let k = 0; k < count; k++) u8[k] = this.state[alive[k]]
    this.state.set(u8, 0)
    this.state.fill(STATE_FREE, count)

    this.highWater = count
    this.freeTop = 0
  }

  private rebuildSensorTable(): void {
    const k = Math.max(3, Math.min(12, Math.round(this.params.sensorCount)))
    const t = new Float32Array(k * 2)
    for (let j = 0; j < k; j++) {
      const a = (j / k) * Math.PI * 2
      t[j * 2] = Math.cos(a)
      t[j * 2 + 1] = Math.sin(a)
    }
    this.sinCos = t
  }

  setParams(p: Partial<SimParams>): void {
    const gridChanged = p.grid !== undefined && p.grid !== this.params.grid
    const capChanged = p.maxMotes !== undefined && p.maxMotes !== this.params.maxMotes
    const sensorChanged = p.sensorCount !== undefined && p.sensorCount !== this.params.sensorCount
    if (p.grid !== undefined) {
      const cap = maxGridSize()
      if (p.grid > cap) p = { ...p, grid: cap }
    }
    const gridWanted = p.grid !== undefined && p.grid !== this.params.grid
    this.params = { ...this.params, ...p }
    if (sensorChanged) this.rebuildSensorTable()
    if (gridChanged && gridWanted) {
      const previous = this.n
      const scale = this.params.grid / this.n
      this.n = this.params.grid
      try {
        this.allocateFields()
      } catch {
        // Out of memory: stay where we were rather than taking the page down.
        this.n = previous
        this.params.grid = previous
        this.allocateFields()
        return
      }
      this.resetRegion()
      for (let i = 0; i < this.highWater; i++) {
        if (this.state[i] === STATE_FREE) continue
        this.px[i] *= scale
        this.py[i] *= scale
        this.pz[i] *= scale
      }
      for (const f of this.foods) {
        f.x *= scale
        f.y *= scale
        f.z *= scale
      }
      for (const so of this.solids) {
        so.x *= scale
        so.y *= scale
        so.z *= scale
        so.hx *= scale
        so.hy *= scale
        so.hz *= scale
      }
      this.rebuildSolids()
      this.envDirty = true
    }
    if (capChanged) {
      // Growing or shrinking the population cap restarts the colony; the
      // alternative is copying a dozen typed arrays for no real benefit.
      this.reset()
    }
  }

  setEnv(e: Partial<EnvParams>): void {
    this.env = { ...this.env, ...e }
    this.envDirty = true
  }

  reset(): void {
    this.carb.clear()
    this.prot.clear()
    this.trail.clear()
    this.vein.clear()
    this.bio.clear()
    this.foods = []
    this.solids = []
    this.solidMask.fill(0)
    this.gripField.fill(0)
    this.slipField.fill(0)
    this.obstacles = undefined
    this.resetRegion()
    this.timeMin = 0
    this.tears = 0
    this.spentResidueMg = 0
    this.circulatingCarb = 0
    this.circulatingProtein = 0
    this.allocate(this.params.maxMotes)
    this.tracePool = zeroTraces()
    this.traceDemandRate = zeroTraces()
    this.traceSufficiency = zeroTraces()
    this.microFactor = 1
    this.intakeCarb = 0
    this.intakeProtein = 0
    this.voidedCarb = 0
    this.voidedProtein = 0
    this.biomassMadeUg = 0
    this.substrateUsedUg = 0
    this.divisions = 0
    this.deaths = 0
    this.peakBiomassMg = 0
    this.mobilisedMg = 0
    this.fillCarb = 0
    this.fillProt = 0
    this.growthRateEma = 0
    this.lastStatsBiomass = 0
    this.lastStatsTime = 0
    this.envDirty = true
    this.envRebuiltAt = -1e9
  }

  // -------------------------------------------------------------------------
  // Population
  // -------------------------------------------------------------------------

  private spawn(): number {
    if (this.motes + this.dormantCount >= this.params.maxMotes) return -1
    let i: number
    if (this.freeTop > 0) i = this.freeSlots[--this.freeTop]
    else if (this.highWater < this.capacity) i = this.highWater++
    else return -1
    this.state[i] = STATE_ACTIVE
    this.motes++
    this.starveMin[i] = 0
    this.dormantMin[i] = 0
    this.trait[i] = Math.random()
    return i
  }

  private kill(i: number): void {
    if (this.state[i] === STATE_FREE) return
    if (this.state[i] === STATE_DORMANT) this.dormantCount--
    else this.motes--
    this.state[i] = STATE_FREE
    // Everything it was made of goes back into the substrate ledger, and
    // whatever it was still carrying is drawn back into the body.
    this.recycleUg += this.biomass[i]
    this.circulatingCarb += this.cStore[i] * 0.7
    this.circulatingProtein += this.pStore[i] * 0.7
    this.biomass[i] = 0
    this.cStore[i] = 0
    this.pStore[i] = 0
    if (this.freeTop < this.freeSlots.length) this.freeSlots[this.freeTop++] = i
    this.deaths++
  }

  /** Drop a plasmodium inoculum: a knot of motes with a starter ration. */
  inoculate(x: number, y: number, z: number, count = 220, radius = 2): number {
    let made = 0
    // Under gravity an inoculum is a blob laid on a surface, not a ball hanging
    // in mid-air, so it settles and spreads out flat.
    const flat = this.env.gravity > 0
    if (flat) y = this.surfaceBelow(x, y, z) + 1.2
    for (let k = 0; k < count; k++) {
      const i = this.spawn()
      if (i < 0) break
      // Uniform-ish point in a small sphere.
      const u = Math.random()
      const r = radius * Math.cbrt(u)
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const sp = Math.sin(phi)
      const spreadH = flat ? 1.6 : 1
      const spreadV = flat ? 0.35 : 1
      this.px[i] = clamp(x + r * sp * Math.cos(theta) * spreadH, 1.5, this.n - 1.5)
      this.py[i] = clamp(y + r * Math.cos(phi) * spreadV, 1.5, this.n - 1.5)
      this.pz[i] = clamp(z + r * sp * Math.sin(theta) * spreadH, 1.5, this.n - 1.5)
      let escape = 0
      while (escape++ < 8 && this.isSolid(this.px[i], this.py[i], this.pz[i])) {
        this.py[i] = Math.min(this.n - 1.5, this.py[i] + 1)
      }
      // The advancing fan points outwards from the point of transfer.
      let ox = this.px[i] - x + (Math.random() - 0.5) * 1.8
      let oy = this.py[i] - y + (Math.random() - 0.5) * 1.8
      let oz = this.pz[i] - z + (Math.random() - 0.5) * 1.8
      const ol = Math.hypot(ox, oy, oz)
      if (ol < 1e-3) {
        const dt = Math.random() * Math.PI * 2
        const dp = Math.acos(2 * Math.random() - 1)
        ox = Math.sin(dp) * Math.cos(dt)
        oy = Math.cos(dp)
        oz = Math.sin(dp) * Math.sin(dt)
      } else {
        ox /= ol
        oy /= ol
        oz /= ol
      }
      this.dx[i] = ox
      this.dy[i] = oy
      this.dz[i] = oz
      this.biomass[i] = BIO.life.seedBiomassUg * (0.85 + Math.random() * 0.3)
      // Transferred plasmodium arrives well fed - that reserve is what buys it
      // time to find the first meal.
      this.cStore[i] = BIO.kinetics.storeCapacityCarb * 0.85 * this.biomass[i]
      this.pStore[i] = BIO.kinetics.storeCapacityProtein * 0.85 * this.biomass[i]
      this.satiety[i] = 0.85
      made++
    }
    // Transferred plasmodium brings its own mineral and cofactor reserve.
    if (made > 0) {
      // A transfer is a lump of established plasmodium, and it brings its own
      // store of minerals and cofactors with it.
      const seedUg = made * BIO.life.seedBiomassUg * 20
      for (const t of TRACE_IDS) this.tracePool[t] += seedUg * BIO.biomass.traceFraction[t]
    }
    return made
  }

  /**
   * Remove the organism but leave the experiment standing: deposits, objects and
   * whatever has already dissolved into the agar all stay exactly where they are.
   * Useful for re-running the same map from a fresh inoculum.
   */
  clearMould(): void {
    for (let i = 0; i < this.highWater; i++) if (this.state[i] !== STATE_FREE) this.kill(i)
    this.trail.clear()
    this.vein.clear()
    this.bio.clear()
    this.deaths = 0
    this.tears = 0
    this.recycleUg = 0
  }

  /** Wipe the organism out of a sphere, leaving the rest of the colony alone. */
  wipeMould(x: number, y: number, z: number, radius: number): number {
    const r2 = radius * radius
    let removed = 0
    for (let i = 0; i < this.highWater; i++) {
      if (this.state[i] === STATE_FREE) continue
      const dx = this.px[i] - x
      const dy = this.py[i] - y
      const dz = this.pz[i] - z
      if (dx * dx + dy * dy + dz * dz > r2) continue
      this.kill(i)
      removed++
    }
    const n = this.n
    const last = n - 1
    const ir = Math.ceil(radius)
    const cx = Math.floor(x)
    const cy = Math.floor(y)
    const cz = Math.floor(z)
    for (let dz = -ir; dz <= ir; dz++) {
      const vz = cz + dz
      if (vz < 0 || vz > last) continue
      for (let dy = -ir; dy <= ir; dy++) {
        const vy = cy + dy
        if (vy < 0 || vy > last) continue
        for (let dx = -ir; dx <= ir; dx++) {
          if (dx * dx + dy * dy + dz * dz > r2) continue
          const vx = cx + dx
          if (vx < 0 || vx > last) continue
          const i = vx + n * (vy + n * vz)
          this.trail.data[i] = 0
          this.vein.data[i] = 0
          this.bio.data[i] = 0
        }
      }
    }
    return removed
  }

  // -------------------------------------------------------------------------
  // Solids
  // -------------------------------------------------------------------------

  private voxel(x: number, y: number, z: number): number {
    const n = this.n
    const last = n - 1
    let ix = Math.floor(x)
    let iy = Math.floor(y)
    let iz = Math.floor(z)
    ix = ix < 0 ? 0 : ix > last ? last : ix
    iy = iy < 0 ? 0 : iy > last ? last : iy
    iz = iz < 0 ? 0 : iz > last ? last : iz
    return ix + n * (iy + n * iz)
  }

  isSolid(x: number, y: number, z: number): boolean {
    return this.solidMask[this.voxel(x, y, z)] === 1
  }

  addSolid(
    kindId: string,
    material: Material,
    x: number,
    y: number,
    z: number,
    scale = 1,
    rotated = false,
    dims?: [number, number, number],
    climbable = true,
    yaw = 0,
  ): SolidInstance | null {
    const s = createSolid(kindId, material, x, y, z, scale, rotated, dims, climbable, yaw)
    if (!s) return null
    // Rest it on whatever is underneath. The search starts from the point that
    // was clicked, so clicking the top of a block stacks onto that block rather
    // than dropping through it to the floor.
    const [bx0, , bz0, bx1, , bz1] = solidBounds(s)
    const halfX = (bx1 - bx0) / 2
    const halfZ = (bz1 - bz0) / 2
    const base = this.surfaceBelow(s.x, s.y + 0.5, s.z, halfX, halfZ)
    s.y = base + s.hy
    s.x = clamp(s.x, halfX + 1, this.n - halfX - 1)
    s.z = clamp(s.z, halfZ + 1, this.n - halfZ - 1)
    if (s.y + s.hy > this.n - 1) s.y = this.n - 1 - s.hy
    this.solids.push(s)
    this.rebuildSolids()
    this.envDirty = true
    return s
  }

  removeSolid(id: string): void {
    const i = this.solids.findIndex((s) => s.id === id)
    if (i >= 0) {
      this.solids.splice(i, 1)
      this.rebuildSolids()
      this.envDirty = true
    }
  }

  /** The solid a point is inside, or the nearest one within a radius. */
  pickSolid(x: number, y: number, z: number, within = 5): SolidInstance | null {
    for (const s of this.solids) if (solidContains(s, x, y, z)) return s
    let best: SolidInstance | null = null
    let bestD = within * within
    for (const s of this.solids) {
      const dx = Math.max(0, Math.abs(x - s.x) - s.hx)
      const dy = Math.max(0, Math.abs(y - s.y) - s.hy)
      const dz = Math.max(0, Math.abs(z - s.z) - s.hz)
      const d = dx * dx + dy * dy + dz * dz
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    return best
  }

  /**
   * Height of the first surface at or below `fromY` over a footprint: the top of
   * a solid, or the vessel floor.
   */
  surfaceBelow(x: number, fromY: number, z: number, halfX = 0, halfZ = 0): number {
    let top = 1.2 // the agar floor
    for (const s of this.solids) {
      // Does the footprint overlap this solid in plan view?
      const [sx0, , sz0, sx1, , sz1] = solidBounds(s)
      const ex = (sx1 - sx0) / 2
      const ez = (sz1 - sz0) / 2
      if (Math.abs(x - s.x) > ex + halfX || Math.abs(z - s.z) > ez + halfZ) continue
      const t = solidTopAt(s, clamp(x, sx0, sx1), clamp(z, sz0, sz1))
      if (t === null) continue
      if (t <= fromY + 0.5 && t > top) top = t
    }
    return top
  }

  /** Rasterise the solids into the occupancy mask, grip field and boundary lists. */
  private rebuildSolids(): void {
    const n = this.n
    this.solidMask.fill(0)
    this.gripField.fill(0)
    this.slipField.fill(0)
    if (this.solids.length === 0) {
      this.obstacles = undefined
      return
    }
    const mask = this.solidMask
    const grip = this.gripField
    const slip = this.slipField
    const last = n - 1
    for (const s of this.solids) {
      const [bx0, by0, bz0, bx1, by1, bz1] = solidBounds(s)
      const x0 = Math.max(0, Math.floor(bx0))
      const y0 = Math.max(0, Math.floor(by0))
      const z0 = Math.max(0, Math.floor(bz0))
      const x1 = Math.min(last, Math.ceil(bx1))
      const y1 = Math.min(last, Math.ceil(by1))
      const z1 = Math.min(last, Math.ceil(bz1))
      // A sheer object offers nothing to hold on to at all.
      const adh = s.climbable ? Math.round(MATERIALS[s.material].adhesion * 255) : 0
      for (let z = z0; z <= z1; z++) {
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            if (!solidContains(s, x + 0.5, y + 0.5, z + 0.5)) continue
            mask[x + n * (y + n * z)] = 1
            // Stamp grip into the surrounding voxels, so a mote alongside a face
            // has something to hold on to.
            for (let dz = -1; dz <= 1; dz++) {
              const gz = z + dz
              if (gz < 0 || gz > last) continue
              for (let dy = -1; dy <= 1; dy++) {
                const gy = y + dy
                if (gy < 0 || gy > last) continue
                for (let dx = -1; dx <= 1; dx++) {
                  const gx = x + dx
                  if (gx < 0 || gx > last) continue
                  const gi = gx + n * (gy + n * gz)
                  if (grip[gi] < adh) grip[gi] = adh
                  if (!s.climbable) slip[gi] = 1
                }
              }
            }
          }
        }
      }
    }

    const nn = n * n
    const boundary: number[] = []
    const solid: number[] = []
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) {
        solid.push(i)
        continue
      }
      if (grip[i] === 0 && slip[i] === 0) continue // only voxels beside a solid
      const x = i % n
      const y = ((i - x) / n) % n
      const z = (i - x - y * n) / nn
      const touching =
        (x > 0 && mask[i - 1] === 1) ||
        (x < last && mask[i + 1] === 1) ||
        (y > 0 && mask[i - n] === 1) ||
        (y < last && mask[i + n] === 1) ||
        (z > 0 && mask[i - nn] === 1) ||
        (z < last && mask[i + nn] === 1)
      if (touching) boundary.push(i)
    }
    this.obstacles = {
      mask,
      boundary: Int32Array.from(boundary),
      solid: Int32Array.from(solid),
    }
    // A solid dropped onto existing substrate or slime evicts it.
    for (const i of this.obstacles.solid) {
      this.carb.data[i] = 0
      this.prot.data[i] = 0
      this.trail.data[i] = 0
      this.vein.data[i] = 0
    }
    // Any mote caught inside is pushed up to the nearest free voxel.
    for (let i = 0; i < this.highWater; i++) {
      if (this.state[i] === STATE_FREE) continue
      if (!this.isSolid(this.px[i], this.py[i], this.pz[i])) continue
      let y = this.py[i]
      let tries = 0
      while (tries++ < n && y < n - 1.5 && this.isSolid(this.px[i], y, this.pz[i])) y += 1
      this.py[i] = Math.min(y, n - 1.5)
      this.vy[i] = 0
    }
  }

  /** Surface normal of the obstacle field, pointing away from the solid. */
  private solidNormal(x: number, y: number, z: number, out: number[]): void {
    const n = this.n
    const nn = n * n
    const i = this.voxel(x, y, z)
    const mask = this.solidMask
    const ix = i % n
    const iy = ((i - ix) / n) % n
    const iz = (i - ix - iy * n) / nn
    const last = n - 1
    let ax = 0
    let ay = 0
    let az = 0
    if (ix > 0 && mask[i - 1]) ax += 1
    if (ix < last && mask[i + 1]) ax -= 1
    if (iy > 0 && mask[i - n]) ay += 1
    if (iy < last && mask[i + n]) ay -= 1
    if (iz > 0 && mask[i - nn]) az += 1
    if (iz < last && mask[i + nn]) az -= 1
    const l = Math.hypot(ax, ay, az)
    if (l < 1e-6) {
      out[0] = 0
      out[1] = 1
      out[2] = 0
    } else {
      out[0] = ax / l
      out[1] = ay / l
      out[2] = az / l
    }
  }

  private resetRegion(): void {
    this.region = { x0: 1, y0: 1, z0: 1, x1: 1, y1: 1, z1: 1 }
  }

  /**
   * Grow the integration region so it covers everything that can hold substrate.
   * It only ever grows, which guarantees every non-zero voxel stays inside it and
   * keeps a large vessel cheap while the colony is still small.
   */
  private growRegion(): void {
    const last = this.n - 1
    const r = this.region
    let x0 = r.x0
    let y0 = r.y0
    let z0 = r.z0
    let x1 = r.x1
    let y1 = r.y1
    let z1 = r.z1
    const include = (x: number, y: number, z: number, pad: number) => {
      const a = Math.max(0, Math.floor(x - pad))
      const b = Math.max(0, Math.floor(y - pad))
      const c = Math.max(0, Math.floor(z - pad))
      const d = Math.min(last, Math.ceil(x + pad))
      const e = Math.min(last, Math.ceil(y + pad))
      const f = Math.min(last, Math.ceil(z + pad))
      if (a < x0) x0 = a
      if (b < y0) y0 = b
      if (c < z0) z0 = c
      if (d > x1) x1 = d
      if (e > y1) y1 = e
      if (f > z1) z1 = f
    }
    for (let i = 0; i < this.highWater; i++) {
      if (this.state[i] === STATE_FREE) continue
      include(this.px[i], this.py[i], this.pz[i], REGION_MARGIN)
    }
    for (const f of this.foods) {
      const def = FOOD_BY_ID[f.defId]
      include(f.x, f.y, f.z, def.radius * 2.5 + REGION_MARGIN)
    }
    r.x0 = x0
    r.y0 = y0
    r.z0 = z0
    r.x1 = x1
    r.y1 = y1
    r.z1 = z1
  }

  // -------------------------------------------------------------------------
  // Food
  // -------------------------------------------------------------------------

  addFood(defId: string, x: number, y: number, z: number, massMg?: number): FoodInstance | null {
    const def = FOOD_BY_ID[defId]
    if (!def) return null
    let fx = clamp(x, 1, this.n - 1)
    let fy = clamp(y, 1, this.n - 1)
    const fz = clamp(z, 1, this.n - 1)
    if (this.env.gravity > 0) {
      // A deposit is not going to hover: it lands on the floor, or on top of
      // whatever solid is underneath it.
      fy = this.surfaceBelow(fx, fy, fz) + def.radius * 0.9
    }
    // Never bury a deposit inside a solid.
    let guard = 0
    while (guard++ < this.n && this.isSolid(fx, fy, fz)) fy += 1
    if (fy > this.n - 2) {
      fy = clamp(y, 1, this.n - 2)
      fx = clamp(fx, 1, this.n - 1)
    }
    const f = createFoodInstance(
      def,
      fx,
      clamp(fy, 1, this.n - 1),
      fz,
      massMg ?? def.defaultMassMg,
      this.timeMin,
    )
    this.foods.push(f)
    this.envDirty = true
    return f
  }

  removeFood(id: string): void {
    const i = this.foods.findIndex((f) => f.id === id)
    if (i >= 0) {
      this.foods.splice(i, 1)
      this.envDirty = true
    }
  }

  /** Mass still in this deposit that some enzyme can actually mobilise. */
  private usableMassMg(f: FoodInstance): number {
    const def = FOOD_BY_ID[f.defId]
    let m = 0
    for (const macro of NUTRITIVE_MACROS) {
      const pool = f.pools[macro]
      if (pool <= 0) continue
      const enz = enzymeFor(macro, def.sugarProfile)
      const capability = enz ? ENZYMES[enz].capability : 1
      if (capability > 0.02) m += pool * capability
    }
    return m
  }

  /**
   * Total mass of a given food whose digestible carbon covers nothing more than
   * the colony's maintenance respiration for `hours`.
   *
   * Feed this much and the colony holds its size: enough to pay its upkeep,
   * nothing left over to build with. Less and it starves back, more and it grows.
   */
  rationMassMg(defId: string, hours: number): number {
    const def = FOOD_BY_ID[defId]
    if (!def) return 0
    const a = analyse(def)
    // Carbon-equivalent the food can actually yield, mg per mg of deposit.
    const carbPerMg = a.carbEq / 100
    if (carbPerMg <= 1e-6) return 0
    const tempF = temperatureFactor(this.env.temperatureC)
    const biomassUg = this.totalBiomassUg()
    // Upkeep over the window, in micrograms of carbon-equivalent.
    const upkeepUg = BIO.kinetics.maintenance * biomassUg * hours * 60 * Math.max(0.2, tempF)
    // Only part of what a deposit releases is ever caught by the colony; the
    // rest diffuses away and decays.
    // Most of what a deposit releases diffuses away and decays before anything
    // reaches it, so the ration has to be several times the bare upkeep.
    // Calibrated against a colony that is actually feeding: measured, this holds
    // biomass flat over three days, where twice it doubles the colony and half it
    // starves back.
    const capture = 0.45
    return upkeepUg / 1000 / carbPerMg / capture
  }

  /**
   * Drop deposits at random columns, each landing on whatever is highest at that
   * spot - the agar, or the top of a block if something is in the way.
   */
  scatterFood(defId: string, count: number, massMg?: number): number {
    let made = 0
    // Food the colony cannot find does not maintain anything, so the scatter is
    // drawn around where it currently is, with enough margin to still draw it
    // outwards. With nothing alive, use the whole plate.
    const alive = this.motes + this.dormantCount > 0
    const r = this.region
    const pad = 14
    const x0 = alive ? Math.max(3, r.x0 - pad) : 3
    const x1 = alive ? Math.min(this.n - 3, r.x1 + pad) : this.n - 3
    const z0 = alive ? Math.max(3, r.z0 - pad) : 3
    const z1 = alive ? Math.min(this.n - 3, r.z1 + pad) : this.n - 3
    for (let i = 0; i < count; i++) {
      const x = x0 + Math.random() * (x1 - x0)
      const z = z0 + Math.random() * (z1 - z0)
      // Search from the ceiling so it finds the highest surface in the column.
      const y = this.surfaceBelow(x, this.n - 2, z) + 1
      if (this.addFood(defId, x, y, z, massMg)) made++
    }
    return made
  }

  /** Nearest deposit to a point, within a radius. Used by the erase tool. */
  pickFood(x: number, y: number, z: number, within = 4): FoodInstance | null {
    let best: FoodInstance | null = null
    let bestD = within * within
    for (const f of this.foods) {
      const d = (f.x - x) ** 2 + (f.y - y) ** 2 + (f.z - z) ** 2
      if (d < bestD) {
        bestD = d
        best = f
      }
    }
    return best
  }

  /**
   * Extracellular digestion. Free solutes leach out on their own; everything
   * polymerised waits for an enzyme, and enzymes are only secreted where the
   * plasmodium has actually arrived.
   */
  private digest(dt: number, tempF: number): void {
    for (let k = this.foods.length - 1; k >= 0; k--) {
      const f = this.foods[k]
      const def = FOOD_BY_ID[f.defId]
      const mass = foodMassMg(f)
      // A deposit is finished once there is nothing left in it that any enzyme
      // can touch. What remains is cellulose, chitin, lactose - residue, not
      // food - so it is cleared off the plate and carried to the ledger rather
      // than sitting there forever as a crumb that never gets smaller.
      if (mass <= 1e-4 || this.usableMassMg(f) < 0.04) {
        this.spentResidueMg += foodResidueMg(f)
        this.foods.splice(k, 1)
        this.envDirty = true
        continue
      }
      const frac = clamp(mass / f.initialMassMg, 0, 1)
      const radius = Math.max(1, def.radius * Math.cbrt(frac))

      // Colonisation: how much plasmodium is sitting on this deposit.
      const bioHere = this.bio.sample(f.x, f.y, f.z)
      const target = michaelis(bioHere, COLONISATION_KM)
      f.colonization += (target - f.colonization) * Math.min(1, dt * 0.6)

      const access = MATRIX[def.matrix].access
      const leach = MATRIX[def.matrix].leach
      // Shrinking sphere: release scales with surface area, not volume.
      const surface = Math.pow(frac, 2 / 3)

      let carbUg = 0
      let protUg = 0
      let releasedMg = 0

      for (const macro of NUTRITIVE_MACROS) {
        const pool = f.pools[macro]
        if (pool <= 1e-9) continue
        const enz = enzymeFor(macro, def.sugarProfile)
        const capability = enz ? ENZYMES[enz].capability : 1
        if (capability <= 1e-6) continue
        // Sugars and free amino acids are already in solution and simply leach.
        const soluble = macro === 'sugars' || macro === 'freeAminoAcids'
        const rate =
          ((soluble ? leach : 0) +
            ENZYME_RATE *
              (BASAL_SECRETION + (1 - BASAL_SECRETION) * f.colonization) *
              capability) *
          access *
          tempF *
          surface
        // Shrinking-core kinetics. Enzymes work on the surface of a deposit, so
        // the rate goes with surface area and the size it started at, not with
        // how much bulk is left. First-order release in the remaining mass would
        // be asymptotic - the deposit would get ever smaller and never actually
        // finish - which is both wrong for a solid and leaves a crumb on the
        // plate forever.
        const released = Math.min(pool, (def.comp[macro] / 100) * f.initialMassMg * rate * dt)
        if (released <= 1e-12) continue
        f.pools[macro] = pool - released
        releasedMg += released
        const y = MACRO_YIELD[macro]
        carbUg += released * 1000 * y.carbEq
        protUg += released * 1000 * y.proteinEq
      }

      // Minerals dissolve alongside, a little faster than the bulk.
      const relFrac = releasedMg / Math.max(mass, 1e-9)
      const mineralFrac = Math.min(1, relFrac + leach * access * dt)
      if (mineralFrac > 0) {
        for (const t of TRACE_IDS) {
          const have = f.traces[t]
          if (!have) continue
          const out = have * mineralFrac
          f.traces[t] = have - out
          this.tracePool[t] += out
        }
        f.pools.ash = Math.max(0, f.pools.ash * (1 - mineralFrac))
      }
      // Water and non-nutritive mass go away with the rest of the deposit.
      if (relFrac > 0) {
        f.pools.water = Math.max(0, f.pools.water * (1 - relFrac))
      }
      if (f.pools.inert > 0) {
        f.pools.inert = Math.max(0, f.pools.inert * (1 - leach * access * dt))
      }

      if (carbUg > 0) depositSphere(this.carb, f.x, f.y, f.z, radius, carbUg)
      if (protUg > 0) depositSphere(this.prot, f.x, f.y, f.z, radius, protUg)
      f.assimilatedMg += releasedMg
      this.mobilisedMg += releasedMg
      f.residueMg = foodResidueMg(f)
    }
  }

  // -------------------------------------------------------------------------
  // Integration
  // -------------------------------------------------------------------------

  /** Advance by a real-time delta. Returns how much simulated time passed. */
  advance(realSeconds: number, speedMultiplier = 1, maxSubsteps = 12): StepReport {
    const simMinutes = realSeconds * this.params.minutesPerSecond * speedMultiplier
    let remaining = simMinutes
    let substeps = 0
    while (remaining > 1e-6 && substeps < maxSubsteps) {
      const dt = Math.min(FIXED_STEP_MIN, remaining)
      this.step(dt)
      remaining -= dt
      substeps++
    }
    return { substeps, simMinutes: simMinutes - Math.max(0, remaining) }
  }

  step(dt: number): void {
    const P = this.params
    const E = this.env
    const n = this.n

    const tempF = temperatureFactor(E.temperatureC)
    const humF = humidityFactor(E.relativeHumidity)
    const heatDmg = heatDamagePerMin(E.temperatureC)
    const lightGrowth = 1 - BIO.light.growthPenalty * E.illumination
    const baseMotility = motilityFactor(E.agarPercent) * humF
    const cold = E.temperatureC < BIO.tolerance.coldDormancyBelowC
    const gravity = E.gravity
    const normal = this.scratchNormal
    const hasSolids = this.obstacles !== undefined

    // --- biomass density map ---
    // The body map is what the colony uses to hold itself together, so it has to
    // be current, not a snapshot from two simulated minutes ago. It is therefore
    // maintained incrementally - each mote removes itself from the voxel it is
    // leaving and adds itself to the one it arrives in - with a full rebuild now
    // and then to clear accumulated floating-point drift.
    if (this.stepCount % BIO_MAP_EVERY === 0) {
      this.bio.clearRegion(this.region)
      for (let i = 0; i < this.highWater; i++) {
        if (this.state[i] === STATE_FREE) continue
        this.bio.addAt(this.px[i], this.py[i], this.pz[i], this.biomass[i])
      }
    }

    // --- environmental chemistry, refreshed about once a simulated minute ---
    if (this.envDirty || this.timeMin - this.envRebuiltAt > 1) {
      this.envGrid.rebuild(this.foods, E)
      this.envDirty = false
      this.envRebuiltAt = this.timeMin
    }

    this.digest(dt, tempF)

    // --- micronutrient sufficiency, colony-wide ---
    const totalBiomassUg = this.totalBiomassUg()
    this.microFactor = this.updateMicronutrients(totalBiomassUg)

    const K = this.kinetics(tempF)
    const table = this.sinCos
    const sensorK = table.length / 2
    const sd = P.sensorDistance
    const stride = Math.max(1, Math.round(P.sensorStride))
    const phase = this.stepCount % stride
    // Turning is applied on the steps where a mote actually senses, so the blend
    // covers the whole interval since it last looked.
    const turn = clamp(P.turnRate * dt * stride * 4, 0, 1)
    const margin = 1.5
    const lo = margin
    const hi = n - margin

    let dBTotal = 0
    let adhered = 0
    let airborne = 0
    let tears = 0
    let fillC = 0
    let fillP = 0
    let phSum = 0
    let osmoSum = 0
    let toxSum = 0
    let sampled = 0

    for (let i = 0; i < this.highWater; i++) {
      const st = this.state[i]
      if (st === STATE_FREE) continue

      const x = this.px[i]
      const y = this.py[i]
      const z = this.pz[i]
      let bm = this.biomass[i]
      let cs = this.cStore[i]
      let ps = this.pStore[i]
      // Lift this mote out of the body map; it is put back at the end of the
      // step, wherever it has got to and whatever it then weighs.
      this.bio.addAt(x, y, z, -bm)

      const ei = this.envGrid
      const phHere = ei.phAt(x, y, z)
      const osmoHere = ei.osmoAt(x, y, z)
      const toxHere = ei.toxinAt(x, y, z)
      phSum += phHere
      osmoSum += osmoHere
      toxSum += toxHere
      sampled++

      const osmoF = osmoticFactor(osmoHere)
      const capC = BIO.kinetics.storeCapacityCarb * bm
      const capP = BIO.kinetics.storeCapacityProtein * bm
      const satC = capC > 0 ? cs / capC : 0
      const satP = capP > 0 ? ps / capP : 0
      const sat = saturate(0.45 * satC + 0.55 * satP)
      this.satiety[i] = sat
      const tr = this.trait[i]
      const fear = clamp(this.envGrid.repelAt(x, y, z) / FEAR_AT, 0, 1)
      let excite = 0
      const here = this.voxel(x, y, z)
      const gripHere = this.gripField[here] / 255
      const onFloor = y < 2.2
      // Beside an actual object, as opposed to lying on the plate. The two call
      // for different search behaviour, and conflating them costs one or the
      // other: open agar wants a tight forward cone and hard trail-following,
      // which is what draws the searching arms, while a vertical face wants a
      // wide sweep and a taste for unexplored ground, which is what gets the
      // front up and over things.
      const beside = gripHere > 0.05 && !onFloor
      fillC += satC
      fillP += satP

      // ------------------------------------------------------------------
      // Dormant motes: no uptake, minimal maintenance, wake on food.
      // ------------------------------------------------------------------
      if (st === STATE_DORMANT) {
        const localFood = this.carb.nearest(x, y, z) + this.prot.nearest(x, y, z)
        this.dormantMin[i] += dt
        const wasted = bm * 0.00008 * dt * (0.3 + tempF)
        bm -= wasted
        this.recycleUg += wasted
        if (localFood > BIO.life.wakeThreshold && !cold && tempF > 0.05) {
          this.state[i] = STATE_ACTIVE
          this.dormantCount--
          this.motes++
          this.starveMin[i] = 0
          this.dormantMin[i] = 0
        } else if (
          this.dormantMin[i] > BIO.life.dormantLifespanMin ||
          bm < BIO.life.deathBiomassUg * 0.5
        ) {
          this.kill(i)
          continue
        }
        this.biomass[i] = bm
        this.bio.addAt(x, y, z, bm)
        continue
      }

      // ------------------------------------------------------------------
      // Sense: build a cone of sensors around the current heading. Only a
      // fraction of the swarm looks around on any given step; the rest carry on
      // along the heading they already have.
      // ------------------------------------------------------------------
      let hx = this.dx[i]
      let hy = this.dy[i]
      let hz = this.dz[i]
      const senses = stride === 1 || i % stride === phase
      if (senses) {

      // Orthonormal basis perpendicular to the heading.
      let ax: number
      let ay: number
      let az: number
      if (Math.abs(hz) < 0.9) {
        ax = -hy
        ay = hx
        az = 0
      } else {
        ax = 0
        ay = -hz
        az = hy
      }
      let al = Math.hypot(ax, ay, az)
      if (al < 1e-6) {
        ax = 1
        ay = 0
        az = 0
        al = 1
      }
      ax /= al
      ay /= al
      az /= al
      let bx = hy * az - hz * ay
      let by = hz * ax - hx * az
      let bz = hx * ay - hy * ax
      const bl = Math.hypot(bx, by, bz) || 1
      bx /= bl
      by /= bl
      bz /= bl
      // One random phase per mote per step keeps the sensor cone from aliasing
      // onto the lattice.
      const phase = Math.random() * Math.PI * 2
      const cp = Math.cos(phase)
      const spn = Math.sin(phase)
      const ux = ax * cp + bx * spn
      const uy = ay * cp + by * spn
      const uz = az * cp + bz * spn
      const vx = -ax * spn + bx * cp
      const vy = -ay * spn + by * cp
      const vz = -az * spn + bz * cp

      // Appetite: chase whichever currency this mote is short of. Physarum
      // really does bias its foraging towards the nutrient it currently lacks.
      const needFrac = (ps + 1e-6) / (ps + cs + 2e-6)
      const appP = clamp(0.45 + (BIO.optimum.proteinIntakeFraction - needFrac) * 2.2, 0.05, 2.2)
      const appC = clamp(0.45 - (BIO.optimum.proteinIntakeFraction - needFrac) * 2.2, 0.05, 2.2)
      // A starving mote will cross ground it would otherwise refuse.
      const aversion = P.repellentAversion * (0.5 + 0.5 * sat)
      const lightBias = BIO.light.phototaxis * E.illumination
      // How stubbornly this particular mote searches before giving up.
      const persistence = 0.2 + (0.62 + 0.3 * tr) * (1 - sat)
      const surfaceSeek = hasSolids ? P.surfaceAffinity * (0.5 + 0.5 * (1 - sat)) : 0
      // The body holds together through the fed part of itself, and explores
      // with the hungry part. That is the shape of the real thing: a dense mass
      // that stays dense, with an exploratory fringe reaching out of it. Inverting
      // this gives a cloud of independent foragers that never coalesces.
      const cohesion = P.cohesion * (0.3 + 0.95 * sat)
      const novelty = beside
        ? 1.6 * (1 - sat)
        : sat < 0.32
          ? 1.5 * (0.32 - sat)
          : 0
      // A fed mote looks where it is going. A starving one looks everywhere,
      // including backwards, which is how an unproductive branch finds its own
      // trail again and retracts along it towards the rest of the colony.
      // A narrow cone is what makes the front travel in long lines and spread,
      // rather than curling back on itself into a blob; measured, it roughly
      // triples the reach of the network for the same biomass. It still opens up
      // when the mote is hungry, because that is how it turns towards food it has
      // caught the smell of, and wider still beside an object, because wrapping
      // around a face is what gets the front up and over.
      const cone = beside
        ? clamp(P.sensorAngle * (1 + (1.85 + 0.9 * tr) * (1 - sat)), 0.08, 2.3)
        : clamp(P.sensorAngle * (1 + (0.85 + 0.55 * tr) * (1 - sat)), 0.08, 1.3)
      const cosA = Math.cos(cone)
      const sinA = Math.sin(cone)

      let bestScore = -Infinity
      let bestNutrient = 0
      let bsx = hx
      let bsy = hy
      let bsz = hz

      for (let j = -1; j < sensorK; j++) {
        let sx: number
        let sy: number
        let sz: number
        if (j < 0) {
          sx = hx
          sy = hy
          sz = hz
        } else {
          const ct = table[j * 2]
          const stt = table[j * 2 + 1]
          sx = hx * cosA + (ux * ct + vx * stt) * sinA
          sy = hy * cosA + (uy * ct + vy * stt) * sinA
          sz = hz * cosA + (uz * ct + vz * stt) * sinA
        }
        const qx = x + sx * sd
        const qy = y + sy * sd
        const qz = z + sz * sd
        const c = this.carb.nearest(qx, qy, qz)
        const p = this.prot.nearest(qx, qy, qz)
        const tr = this.trail.nearest(qx, qy, qz)
        // Thigmotaxis: a wettable surface is worth following, which is how the
        // front gets up the side of things instead of only around them.
        const surf = surfaceSeek === 0 ? 0 : surfaceSeek * (this.gripField[this.voxel(qx, qy, qz)] / 255)
        // Cohesion: stay part of the organism. This is what makes the colony a
        // single mass that bulges towards food, rather than a spray of
        // independent branches wandering off in all directions.
        const body = cohesion === 0 ? 0 : cohesion * michaelis(this.bio.nearest(qx, qy, qz), COHESION_KM)
        // Novelty. An established tube is for transport, not for searching, so a
        // hungry front prefers ground it has not already worked over. This is
        // what carries the front up and around an object instead of leaving it
        // circling the base of it.
        const stale = novelty === 0 ? 0 : novelty * michaelis(this.vein.nearest(qx, qy, qz), 25)
        // Square-root compression: concentrations span several orders of
        // magnitude, and argmax over raw values would let one term swamp the rest.
        let score =
          surf +
          body -
          stale +
          P.trailAffinity * TRAIL_WEIGHT * michaelis(tr, TRAIL_KM) +
          P.nutrientAffinity * (appC * Math.sqrt(c) + appP * Math.sqrt(p)) -
          aversion * REPEL_SCALE * this.envGrid.repelAt(qx, qy, qz) -
          LIGHT_SCALE * lightBias * sy
        // Search commitment: a hungry front pushes on rather than dithering.
        if (j < 0) score += persistence
        // Keep away from the vessel wall.
        if (qx < lo || qx > hi || qy < lo || qy > hi || qz < lo || qz > hi) score -= 8
        if (score > bestScore) {
          bestScore = score
          bestNutrient = appC * c + appP * p
          bsx = sx
          bsy = sy
          bsz = sz
        }
      }

      // ------------------------------------------------------------------
      // Steer and move.
      // ------------------------------------------------------------------
      // Excitement: a strong smell ahead and the mote commits to it, turning
      // harder and holding its line. Fear: in something it wants out of, it
      // turns away from the worst of it and runs.
      excite = michaelis(bestNutrient, EXCITE_KM) * (1 - sat * 0.5)
      this.mood[i] += (excite - fear - this.mood[i]) * Math.min(1, dt * 2)

      const commit = turn * (1 + 0.9 * excite)
      hx += (bsx - hx) * commit + (Math.random() - 0.5) * P.randomness
      hy += (bsy - hy) * commit + (Math.random() - 0.5) * P.randomness
      hz += (bsz - hz) * commit + (Math.random() - 0.5) * P.randomness

      if (fear > 0.04) {
        // Flee down the repellent gradient. Six coarse samples, and only for the
        // few motes that are actually in trouble.
        const g = this.envGrid
        const s = 2.5
        const fx = g.repelAt(x - s, y, z) - g.repelAt(x + s, y, z)
        const fy = g.repelAt(x, y - s, z) - g.repelAt(x, y + s, z)
        const fz = g.repelAt(x, y, z - s) - g.repelAt(x, y, z + s)
        const fl = Math.hypot(fx, fy, fz)
        if (fl > 1e-5) {
          const w = fear * FLEE_WEIGHT
          hx += (fx / fl) * w
          hy += (fy / fl) * w
          hz += (fz / fl) * w
        }
      }
      const hl = Math.hypot(hx, hy, hz) || 1
      hx /= hl
      hy /= hl
      hz /= hl
      }

      // ------------------------------------------------------------------
      // Weight, grip and support.
      //
      // The plasmodium can only go up if it is holding on to something: a
      // surface it can adhere to, or a slime tube thick enough to carry it. What
      // it cannot hold, it sags away from, and a span that sags far enough tears.
      // ------------------------------------------------------------------
      const trailHere = this.trail.nearest(x, y, z)
      // A front reaching out over a gap is cantilevered off the tube behind it,
      // which is how a real plasmodium bridges: the span thickens as it extends,
      // and it only falls when it reaches out further than the tube can carry.
      const trailBehind = this.trail.nearest(x - hx * 1.2, y - hy * 1.2, z - hz * 1.2)
      const support = trailHere > trailBehind * 0.8 ? trailHere : trailBehind * 0.8
      const sheer = this.slipField[here] === 1
      const grip = onFloor ? 1 : gripHere
      const hold = grip * GRIP_STRENGTH + SLIME_HOLD * michaelis(support, HOLD_KM)
      const weight = gravity * (0.55 + 0.45 * (bm / BIO.kinetics.referenceBiomassUg))
      const unsupported = clamp(weight - hold, 0, 1)
      if (grip > 0.05) adhered++
      else if (unsupported > 0) airborne++

      if (sheer && hy > 0) {
        // Nothing to grip: the front slides off rather than going up. This holds
        // even with gravity switched off, because a sheer wall is a constraint
        // on the geometry, not a consequence of weight.
        hy = -0.15
        this.vy[i] = Math.min(this.vy[i], -0.5)
      }
      if (gravity > 0) {
        // Sag: the heading is pulled down by whatever the colony cannot hold.
        hy -= unsupported * GRAVITY_STEER * dt * 4
        // Climbing is only as good as the purchase available.
        if (hy > 0) hy *= clamp(0.2 + 0.8 * Math.min(1, hold), 0.05, 1)
        const rl = Math.hypot(hx, hy, hz) || 1
        hx /= rl
        hy /= rl
        hz /= rl
      }

      const motility =
        baseMotility *
        osmoF *
        (1 - BIO.toxicity.motilityPenalty * clamp(toxHere, 0, 1)) *
        // Hungry plasmodium ranges; a mote that has found food stops and thickens
        // instead of wandering off it. How far it ranges is individual.
        (0.25 + (1.1 + 0.5 * tr) * (1 - sat)) *
        // Driving towards a find, or getting out of something unpleasant. The
        // eagerness only applies while there is still an appetite behind it,
        // otherwise a fed mote accelerates straight off the food it just found.
        (1 + 0.8 * excite * (1 - sat) + 1.3 * fear) *
        (cold ? 0.02 : Math.max(0.15, tempF))
      const stepLen = P.speed * motility * dt * 4
      let nx = x + hx * stepLen
      let ny = y + hy * stepLen
      let nz = z + hz * stepLen

      // Free sag, which is what actually collapses an overreaching span.
      if (gravity > 0) {
        if (unsupported > 0.001) {
          this.vy[i] = Math.max(-SAG_MAX, this.vy[i] - SAG_ACCEL * unsupported * dt)
          ny += this.vy[i] * dt
          // The tube behind a falling mote is being pulled apart.
          if (this.vy[i] < -0.5) {
            const ti = this.trail.index(x, y, z)
            const before = this.trail.data[ti]
            this.trail.data[ti] = before * (1 - Math.min(0.9, TEAR_RATE * dt))
            if (before > HOLD_KM && this.vy[i] < -2) tears++
          }
        } else {
          this.vy[i] = 0
        }
      }

      if (nx < lo) {
        nx = lo
        hx = Math.abs(hx)
      } else if (nx > hi) {
        nx = hi
        hx = -Math.abs(hx)
      }
      if (ny < lo) {
        ny = lo
        hy = Math.abs(hy)
        this.vy[i] = 0
      } else if (ny > hi) {
        ny = hi
        hy = -Math.abs(hy)
      }
      if (nz < lo) {
        nz = lo
        hz = Math.abs(hz)
      } else if (nz > hi) {
        nz = hi
        hz = -Math.abs(hz)
      }

      // Obstacles: slide along the face rather than stopping dead at it.
      if (this.obstacles !== undefined && this.isSolid(nx, ny, nz)) {
        this.solidNormal(nx, ny, nz, normal)
        const dot = hx * normal[0] + hy * normal[1] + hz * normal[2]
        if (dot < 0) {
          hx -= normal[0] * dot
          hy -= normal[1] * dot
          hz -= normal[2] * dot
          const tl = Math.hypot(hx, hy, hz)
          if (tl > 1e-4) {
            hx /= tl
            hy /= tl
            hz /= tl
            nx = x + hx * stepLen
            ny = y + hy * stepLen
            nz = z + hz * stepLen
          }
        }
        if (this.isSolid(nx, ny, nz)) {
          // Cornered: stay put, turn away from the surface and try again later.
          nx = x
          ny = y
          nz = z
          hx = normal[0]
          hy = normal[1]
          hz = normal[2]
        }
        // Landing on a surface arrests the fall.
        this.vy[i] = 0
      }

      this.px[i] = nx
      this.py[i] = ny
      this.pz[i] = nz
      this.dx[i] = hx
      this.dy[i] = hy
      this.dz[i] = hz

      // Slime deposition. A well-fed mote in a working tube lays down more,
      // which is what makes transport veins thicken and persist.
      // A mote that has found something lays a heavier trail for the rest to
      // follow; one that is fleeing lays almost none, because a route out of a
      // bad place is not a route worth advertising.
      const laid = (0.3 + 0.7 * sat) * (1 + 0.8 * excite) * (1 - 0.75 * fear) * (bm / 10)
      this.trail.addAt(nx, ny, nz, P.depositRate * dt * laid)
      // Tube thickening. Flux is the cytoplasm this mote is actually carrying, so
      // a route that keeps delivering food keeps its tube and the rest fade.
      {
        const vi = this.vein.index(nx, ny, nz)
        const have = this.vein.data[vi]
        // Laying tube is construction, and construction is paid for out of the
        // stores. A mote with nothing in it leaves barely a mark, so a starving
        // colony searching across bare agar does not slowly paint over the whole
        // plate - only routes that carried something stay visible.
        // Tube is built by the organism, not by a stray nucleus: an unreached
        // deposit stays dark until the body gets there.
        const attached = this.bio.nearest(nx, ny, nz) - bm > CONNECTION_FLOOR
        const flux = bm * Math.max(0, sat - 0.12) * 1.3 * (1 - 0.8 * fear) * (attached ? 1 : 0.12)
        this.vein.data[vi] =
          have + VEIN_GAIN * michaelis(flux, VEIN_FLUX_KM) * (1 - have / VEIN_MAX) * dt
      }

      // ------------------------------------------------------------------
      // Uptake: Michaelis-Menten, capped by remaining store capacity.
      // ------------------------------------------------------------------
      const scale = bm / BIO.kinetics.referenceBiomassUg
      const cHere = this.carb.nearest(nx, ny, nz)
      const pHere = this.prot.nearest(nx, ny, nz)
      const roomC = Math.max(0, capC - cs)
      const roomP = Math.max(0, capP - ps)
      if (roomC > 0 && cHere > 0) {
        const want = Math.min(
          roomC,
          K.vmaxCarb * scale * michaelis(cHere, BIO.kinetics.kmCarb) * dt * osmoF,
        )
        const got = this.carb.take(nx, ny, nz, want)
        cs += got
        this.intakeCarb += got
      }
      if (roomP > 0 && pHere > 0) {
        const want = Math.min(
          roomP,
          K.vmaxProtein * scale * michaelis(pHere, BIO.kinetics.kmProtein) * dt * osmoF,
        )
        const got = this.prot.take(nx, ny, nz, want)
        ps += got
        this.intakeProtein += got
      }

      // ------------------------------------------------------------------
      // Cytoplasmic streaming.
      //
      // A plasmodium is one cell: what it takes up at one end is pumped to
      // wherever it is needed. Motes sitting on a tube exchange with a shared
      // circulating pool at a rate set by how thick that tube is, so a connected
      // body shares everything it finds and a branch that has lost its
      // connection is on its own. That is the whole of the organism's logistics,
      // and it is why it can put its mass where the food is.
      // ------------------------------------------------------------------
      const conductance = michaelis(this.vein.nearest(nx, ny, nz), CONDUCTANCE_KM)
      if (conductance > 0.02 && P.circulation > 0) {
        const rate = Math.min(0.9, P.circulation * conductance * dt * 4)
        const wantC = CIRCULATION_TARGET * capC
        if (cs > wantC) {
          const give = (cs - wantC) * rate
          cs -= give
          this.circulatingCarb += give
        } else {
          const take = Math.min((wantC - cs) * rate, this.circulatingCarb)
          cs += take
          this.circulatingCarb -= take
        }
        const wantP = CIRCULATION_TARGET * capP
        if (ps > wantP) {
          const give = (ps - wantP) * rate
          ps -= give
          this.circulatingProtein += give
        } else {
          const take = Math.min((wantP - ps) * rate, this.circulatingProtein)
          ps += take
          this.circulatingProtein -= take
        }
      }

      // ------------------------------------------------------------------
      // Maintenance respiration, then growth.
      // ------------------------------------------------------------------
      let maint = K.maintenance * bm * dt
      const burn = Math.min(cs, maint)
      cs -= burn
      maint -= burn
      if (maint > 1e-12) {
        // Catabolise protein reserve at a conversion penalty.
        const needP = maint / BIO.kinetics.proteinToCarbEfficiency
        const fromP = Math.min(ps, needP)
        ps -= fromP
        maint -= fromP * BIO.kinetics.proteinToCarbEfficiency
      }
      if (maint > 1e-12) {
        const lost = maint * BIO.kinetics.autophagyCost
        bm -= lost
        this.recycleUg += lost
        this.starveMin[i] += dt
      } else if (this.starveMin[i] > 0) {
        this.starveMin[i] = Math.max(0, this.starveMin[i] - dt * 3)
      }

      const growthEnv = tempF * phFactor(phHere) * osmoF * humF * lightGrowth * this.microFactor
      if (growthEnv > 1e-4) {
        const carbCost = BIO.biomass.carbEqPerUg + BIO.biomass.anabolicOverhead
        let dB = BIO.kinetics.muMax * bm * growthEnv * dt
        const byP = ps / BIO.biomass.proteinEqPerUg
        const byC = cs / carbCost
        if (byP < dB) dB = byP
        if (byC < dB) dB = byC
        if (dB > 1e-9) {
          ps -= dB * BIO.biomass.proteinEqPerUg
          cs -= dB * carbCost
          bm += dB
          dBTotal += dB
          this.biomassMadeUg += dB
          this.substrateUsedUg += dB * (BIO.biomass.proteinEqPerUg + carbCost)
        }
      }

      // Surplus of a currency the mote cannot pair up is respired or excreted.
      if (cs > capC * 0.98) {
        const out = cs * OVERFLOW_VOID_PER_MIN * dt
        cs -= out
        this.voidedCarb += out
      }
      if (ps > capP * 0.98) {
        const out = ps * OVERFLOW_VOID_PER_MIN * dt
        ps -= out
        this.voidedProtein += out
      }

      // ------------------------------------------------------------------
      // Damage, dormancy, division, death.
      // ------------------------------------------------------------------
      const dmg = heatDmg + osmoticDamagePerMin(osmoHere) + toxHere * BIO.toxicity.damagePerLoadMin
      if (dmg > 0) {
        const lost = bm * Math.min(0.5, dmg * dt)
        bm -= lost
        this.recycleUg += lost
      }

      // Light plus starvation is the sporulation trigger.
      if (E.illumination > 0.25 && this.starveMin[i] > 60) {
        if (Math.random() < BIO.light.sporulationPerMin * E.illumination * dt) {
          this.biomass[i] = bm
          this.kill(i)
          continue
        }
      }

      this.biomass[i] = bm
      this.cStore[i] = cs
      this.pStore[i] = ps
      this.bio.addAt(nx, ny, nz, bm)

      if (bm < BIO.life.deathBiomassUg) {
        this.kill(i)
        continue
      }
      if (
        bm < BIO.life.dormancyBiomassUg ||
        this.starveMin[i] > BIO.life.starvationToDormancyMin * (0.6 + 0.8 * tr) ||
        cold
      ) {
        this.state[i] = STATE_DORMANT
        this.motes--
        this.dormantCount++
        this.dormantMin[i] = 0
        continue
      }
      // Thickening where the body is already thick achieves nothing; the colony
      // puts new mass at its margins and on its food. And it only divides where
      // it is actually part of the organism.
      const around = this.bio.nearest(nx, ny, nz) - bm
      const crowded = around > CROWDING_LIMIT
      const connected = around > CONNECTION_FLOOR
      if (bm > BIO.life.divideBiomassUg && !crowded && connected) {
        const j = this.spawn()
        if (j >= 0) {
          const half = bm * 0.5
          this.biomass[i] = half
          this.biomass[j] = half
          this.cStore[i] = cs * 0.5
          this.pStore[i] = ps * 0.5
          this.cStore[j] = cs * 0.5
          this.pStore[j] = ps * 0.5
          this.satiety[j] = sat
          this.px[j] = nx
          this.py[j] = ny
          this.pz[j] = nz
          // The daughter tip heads off at an angle: this is how the front branches.
          const spread = 0.65
          let jx = hx + (Math.random() - 0.5) * spread
          let jy = hy + (Math.random() - 0.5) * spread
          let jz = hz + (Math.random() - 0.5) * spread
          const jl = Math.hypot(jx, jy, jz) || 1
          jx /= jl
          jy /= jl
          jz /= jl
          this.dx[j] = jx
          this.dy[j] = jy
          this.dz[j] = jz
          this.divisions++
        }
      }
    }

    // Bill the trace pools once, against the total growth this step, and credit
    // back whatever was salvaged from biomass that was broken down.
    const salvage = this.recycleUg * BIO.biomass.traceRecovery
    this.recycleUg = 0
    if (dBTotal > 0 || salvage > 0) {
      for (const t of TRACE_IDS) {
        const frac = BIO.biomass.traceFraction[t]
        const need = dBTotal * frac
        this.traceDemandRate[t] = need / Math.max(dt, 1e-6)
        this.tracePool[t] = Math.max(0, this.tracePool[t] - need + salvage * frac)
      }
    }

    this.adheredCount = adhered
    this.airborneCount = airborne
    this.tears += tears

    const alive = sampled || 1
    this.fillCarb = fillC / alive
    this.fillProt = fillP / alive
    this.meanPh = phSum / alive
    this.meanOsmo = osmoSum / alive
    this.meanToxin = toxSum / alive

    // --- transport of dissolved substrate and slime ---
    const dScale = clamp(1 + BIO.transport.viscosityPerC * (E.temperatureC - 25), 0.5, 1.6)
    const stepScale = dt / FIXED_STEP_MIN
    const carbMix = clamp(P.nutrientDiffusion * dScale * stepScale, 0, 1)
    // Stokes-Einstein: bigger molecules diffuse more slowly.
    const protMix = clamp(
      carbMix * Math.cbrt(BIO.transport.carbMolarMass / BIO.transport.proteinMolarMass),
      0,
      1,
    )
    this.growRegion()
    const region = this.region
    this.pendingDiffusionMin += dt
    // Tubes are structure, not a solute: they do not diffuse, they are just
    // reabsorbed when no cytoplasm is flowing through them.
    if (P.veinDecayPerMin > 0) {
      const keep = Math.exp(-P.veinDecayPerMin * dt)
      const vd = this.vein.data
      const nn2 = n * n
      for (let z = region.z0; z <= region.z1; z++) {
        for (let y = region.y0; y <= region.y1; y++) {
          const row = z * nn2 + y * n
          for (let x = region.x0; x <= region.x1; x++) vd[row + x] *= keep
        }
      }
    }
    const obstacles = this.obstacles
    // The slime trail is what the swarm steers by, and the fine structure of the
    // network lives in it, so it is integrated every step. The nutrient plumes
    // are smooth and slow, and run on the coarse cadence.
    this.trail.step(
      clamp(P.trailDiffusion * stepScale, 0, 1),
      1 - Math.exp(-P.trailDecayPerMin * dt),
      region,
      obstacles,
    )
    if (this.stepCount % DIFFUSE_EVERY === DIFFUSE_EVERY - 1) {
      const acc = this.pendingDiffusionMin
      this.pendingDiffusionMin = 0
      const nutrientDecay = 1 - Math.exp(-P.nutrientDecayPerMin * acc)
      const span = acc / FIXED_STEP_MIN
      this.carb.step(clamp(carbMix * span, 0, 1), nutrientDecay, region, obstacles)
      this.prot.step(clamp(protMix * span, 0, 1), nutrientDecay, region, obstacles)
    }

    this.timeMin += dt
    this.stepCount++
    // Re-pack the swarm now and then: cheap amortised, and it keeps both the
    // update loop and the field reads tight.
    const population = this.motes + this.dormantCount
    if (
      this.stepCount - this.compactAt > 240 ||
      (this.highWater > 512 && this.highWater > population * 1.6)
    ) {
      this.compactAt = this.stepCount
      this.compact()
    }
  }

  private kinetics(tempF: number) {
    return {
      vmaxCarb: BIO.kinetics.vmaxCarb * tempF,
      vmaxProtein: BIO.kinetics.vmaxProtein * tempF,
      maintenance: BIO.kinetics.maintenance * Math.max(0.25, tempF),
    }
  }

  private updateMicronutrients(totalBiomassUg: number): number {
    // Reference demand: enough of each trace to build another 8% of the colony.
    const reference = Math.max(totalBiomassUg, 50) * 0.08
    let limiting = 1
    let modifier = 1
    for (const t of TRACE_IDS) {
      const need = reference * BIO.biomass.traceFraction[t]
      const suff = need > 0 ? michaelis(this.tracePool[t], need) : 1
      this.traceSufficiency[t] = suff
      if (BIO.biomass.essentialTraces.includes(t)) {
        if (suff < limiting) limiting = suff
      } else {
        modifier *= 0.75 + 0.25 * suff
      }
    }
    return clamp(limiting * modifier, 0, 1)
  }

  totalBiomassUg(): number {
    let s = 0
    for (let i = 0; i < this.highWater; i++) {
      if (this.state[i] !== STATE_FREE) s += this.biomass[i]
    }
    return s
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  /**
   * A snapshot good enough to put the same experiment back on screen after a
   * reload: the vessel, everything in it, and the swarm itself.
   *
   * The diffusion fields are deliberately left out. They are tens of megabytes
   * and they rebuild themselves from the motes and deposits within a few
   * simulated minutes, which is a far better trade than a browser storage quota.
   */
  snapshot(maxMotes = 8000): ColonySnapshot {
    const live: number[] = []
    for (let i = 0; i < this.highWater; i++) if (this.state[i] !== STATE_FREE) live.push(i)
    // If the colony is larger than we are willing to store, keep an even sample
    // of it and scale each surviving mote up so the biomass still adds up.
    const stride = live.length > maxMotes ? Math.ceil(live.length / maxMotes) : 1
    const kept: number[] = []
    for (let k = 0; k < live.length; k += stride) kept.push(live[k])

    const count = kept.length
    const f = new Float32Array(count * 9)
    const st = new Uint8Array(count)
    for (let k = 0; k < count; k++) {
      const i = kept[k]
      const o = k * 9
      f[o] = this.px[i]
      f[o + 1] = this.py[i]
      f[o + 2] = this.pz[i]
      f[o + 3] = this.dx[i]
      f[o + 4] = this.dy[i]
      f[o + 5] = this.dz[i]
      f[o + 6] = this.biomass[i] * stride
      f[o + 7] = this.cStore[i] * stride
      f[o + 8] = this.pStore[i] * stride
      st[k] = this.state[i]
    }
    return {
      version: 1,
      grid: this.n,
      timeMin: this.timeMin,
      params: { ...this.params },
      env: { ...this.env },
      solids: this.solids.map((s) => ({ ...s })),
      foods: this.foods.map((f2) => ({
        ...f2,
        pools: { ...f2.pools },
        traces: { ...f2.traces },
      })),
      tracePool: { ...this.tracePool },
      ledger: {
        intakeCarb: this.intakeCarb,
        intakeProtein: this.intakeProtein,
        biomassMadeUg: this.biomassMadeUg,
        substrateUsedUg: this.substrateUsedUg,
        divisions: this.divisions,
        deaths: this.deaths,
        mobilisedMg: this.mobilisedMg,
        peakBiomassMg: this.peakBiomassMg,
        tears: this.tears,
      },
      moteCount: count,
      moteData: f,
      moteState: st,
    }
  }

  restore(snap: ColonySnapshot): void {
    this.setParams({ ...snap.params, grid: snap.grid })
    this.reset()
    this.setEnv(snap.env)
    this.timeMin = snap.timeMin

    for (const s of snap.solids) this.solids.push({ ...s })
    if (this.solids.length > 0) this.rebuildSolids()
    for (const f of snap.foods) {
      this.foods.push({ ...f, pools: { ...f.pools }, traces: { ...f.traces } })
    }
    this.tracePool = { ...snap.tracePool }
    Object.assign(this, snap.ledger)

    const f = snap.moteData
    for (let k = 0; k < snap.moteCount; k++) {
      const i = this.spawn()
      if (i < 0) break
      const o = k * 9
      this.px[i] = f[o]
      this.py[i] = f[o + 1]
      this.pz[i] = f[o + 2]
      this.dx[i] = f[o + 3]
      this.dy[i] = f[o + 4]
      this.dz[i] = f[o + 5]
      this.biomass[i] = f[o + 6]
      this.cStore[i] = f[o + 7]
      this.pStore[i] = f[o + 8]
      this.satiety[i] = 0.5
      if (snap.moteState[k] === STATE_DORMANT) {
        this.state[i] = STATE_DORMANT
        this.motes--
        this.dormantCount++
      }
    }
    this.envDirty = true
    this.growRegion()
  }

  // -------------------------------------------------------------------------
  // Reporting
  // -------------------------------------------------------------------------

  buildStats(): ColonyStats {
    const biomassUg = this.totalBiomassUg()
    const biomassMg = biomassUg / 1000
    this.peakBiomassMg = Math.max(this.peakBiomassMg, biomassMg)

    const dtMin = this.timeMin - this.lastStatsTime
    if (dtMin > 0.5) {
      const rate =
        this.lastStatsBiomass > 1e-6
          ? ((biomassMg - this.lastStatsBiomass) / this.lastStatsBiomass) * (60 / dtMin)
          : 0
      this.growthRateEma = this.growthRateEma * 0.7 + rate * 0.3
      this.lastStatsTime = this.timeMin
      this.lastStatsBiomass = biomassMg
    }

    const intakeTotal = this.intakeProtein + this.intakeCarb
    const proteinFraction = intakeTotal > 1e-9 ? this.intakeProtein / intakeTotal : 0
    const pcRatio = pcRatioFromFraction(proteinFraction)

    const traces: TraceStatus[] = TRACE_IDS.map((t) => ({
      id: t,
      label: TRACE_LABEL[t],
      pool: this.tracePool[t],
      demand: this.traceDemandRate[t],
      sufficiency: this.traceSufficiency[t],
      essential: BIO.biomass.essentialTraces.includes(t),
    }))

    let foodRemainingMg = 0
    let residueMg = this.spentResidueMg
    let assimilatedMg = 0
    for (const f of this.foods) {
      foodRemainingMg += foodMassMg(f)
      residueMg += f.residueMg
      assimilatedMg += f.assimilatedMg
    }

    const tempF = temperatureFactor(this.env.temperatureC)
    const phF = phFactor(this.meanPh || this.env.substratePh)
    const osmoF = osmoticFactor(this.meanOsmo || this.env.substrateOsmolarity)
    const humF = humidityFactor(this.env.relativeHumidity)
    const balF = balanceFactor(proteinFraction)
    const lightF = 1 - BIO.light.growthPenalty * this.env.illumination

    const limiting = this.limitingFactor()

    const stats: ColonyStats = {
      timeMin: this.timeMin,
      motes: this.motes,
      dormant: this.dormantCount,
      biomassMg,
      peakBiomassMg: this.peakBiomassMg,
      growthRatePerHour: this.growthRateEma,
      divisions: this.divisions,
      deaths: this.deaths,
      intakeProtein: this.intakeProtein,
      intakeCarb: this.intakeCarb,
      pcRatio,
      targetPcRatio: 2,
      limiting,
      factors: {
        temperature: tempF,
        ph: phF,
        osmotic: osmoF,
        humidity: humF,
        balance: balF,
        micronutrient: this.microFactor,
        light: lightF,
        total: tempF * phF * osmoF * humF * lightF * this.microFactor,
      },
      substrateProteinUg: this.prot.total(this.region),
      substrateCarbUg: this.carb.total(this.region),
      networkVoxels: this.trail.countAbove(2, this.region),
      exploredFraction: 0,
      veinVolumeMm3: this.vein.countAbove(VEIN_VISIBLE, this.region),
      veinMass: this.vein.total(this.region),
      adhered: this.adheredCount,
      airborne: this.airborneCount,
      tears: this.tears,
      solids: this.solids.length,
      foodRemainingMg,
      residueMg,
      assimilatedMg,
      growthEfficiency:
        this.substrateUsedUg > 1e-6 ? this.biomassMadeUg / this.substrateUsedUg : 0,
      meanPh: this.meanPh || this.env.substratePh,
      meanOsmolarity: this.meanOsmo || this.env.substrateOsmolarity,
      toxinLoad: this.meanToxin,
      traces,
      diagnostics: [],
    }
    stats.exploredFraction = stats.networkVoxels / (this.n * this.n * this.n)
    stats.diagnostics = this.diagnose(stats)
    return stats
  }

  private limitingFactor(): ColonyStats['limiting'] {
    if (this.motes + this.dormantCount === 0) return 'none'
    if (this.microFactor < 0.55) return 'micronutrient'
    const c = this.fillCarb
    const p = this.fillProt
    if (c < 0.12 && p < 0.12) return 'energy'
    if (p < 0.18 && c > p + 0.15) return 'protein'
    if (c < 0.18 && p > c + 0.15) return 'carbohydrate'
    return 'balanced'
  }

  private diagnose(s: ColonyStats): Diagnostic[] {
    const d: Diagnostic[] = []
    const push = (level: Diagnostic['level'], text: string) => d.push({ level, text })

    if (s.motes + s.dormant === 0) {
      push('bad', 'No living plasmodium. Inoculate the vessel to begin.')
      return d
    }
    if (s.motes === 0 && s.dormant > 0) {
      push('bad', `All ${s.dormant} motes have encysted as sclerotia. They will revive if food reaches them.`)
    }

    // Diet balance, on the nutritional-geometry axis.
    if (s.intakeProtein + s.intakeCarb > 20) {
      const r = s.pcRatio
      if (!isFinite(r)) push('warn', 'Intake is pure nitrogen: no carbon to burn or build with.')
      else if (r < 0.7)
        push(
          'warn',
          `Intake is ${r.toFixed(2)}:1 protein:carbohydrate - carbon-loaded. The optimum is 2:1, so growth efficiency is ${(s.factors.balance * 100).toFixed(0)}%.`,
        )
      else if (r > 4)
        push(
          'warn',
          `Intake is ${r.toFixed(1)}:1 protein:carbohydrate - short of carbon. Add a sugar or starch source.`,
        )
      else if (r >= 1.3 && r <= 3)
        push('ok', `Intake is ${r.toFixed(2)}:1 protein:carbohydrate, close to the 2:1 optimum.`)
    }

    switch (s.limiting) {
      case 'protein':
        push('warn', 'Protein-limited: nitrogen stores are empty while carbon sits full.')
        break
      case 'carbohydrate':
        push('warn', 'Carbon-limited: plenty of nitrogen, nothing to fuel anabolism with.')
        break
      case 'energy':
        push('bad', 'Both stores empty - the colony is running on autophagy.')
        break
      case 'micronutrient':
        push('bad', 'Growth is held back by a mineral or cofactor, not by macronutrients.')
        break
      case 'balanced':
        push('ok', 'Macronutrient supply is balanced.')
        break
    }

    for (const t of s.traces) {
      if (!t.essential) continue
      if (t.sufficiency < 0.35) {
        const cannotMake = t.id === 'thiamine' || t.id === 'heme'
        push(
          'bad',
          cannotMake
            ? `${t.label} exhausted. Physarum cannot synthesise it, so growth stops until it is supplied (yeast extract, liver, bacteria).`
            : `${t.label} exhausted - it is ${(BIO.biomass.traceFraction[t.id] * 100).toFixed(2)}% of dry biomass.`,
        )
      }
    }

    const T = this.env.temperatureC
    if (T > BIO.tolerance.heatDamageAboveC)
      push('bad', `${T.toFixed(0)} C is denaturing: biomass is being lost outright.`)
    else if (T > 29) push('warn', `${T.toFixed(0)} C is past the 26 C optimum; metabolism is inhibited.`)
    else if (T < BIO.tolerance.coldDormancyBelowC)
      push('bad', `${T.toFixed(0)} C is below the dormancy threshold - everything encysts.`)
    else if (T < 18)
      push('info', `${T.toFixed(0)} C: cold. Q10 of 2.2 means roughly ${(s.factors.temperature * 100).toFixed(0)}% of peak rate.`)

    if (s.factors.ph < 0.6)
      push(
        'warn',
        `Local pH is ${s.meanPh.toFixed(1)}; the optimum is ${BIO.optimum.ph}. Uptake is at ${(s.factors.ph * 100).toFixed(0)}%.`,
      )
    if (s.meanOsmolarity > 400)
      push(
        s.meanOsmolarity > BIO.tolerance.osmoDamageAbove ? 'bad' : 'warn',
        `Osmolarity ${s.meanOsmolarity.toFixed(0)} mOsm - water is being pulled out of the plasmodium.`,
      )
    if (s.factors.humidity < 0.85)
      push('warn', `${this.env.relativeHumidity.toFixed(0)}% RH: desiccating. Motility and growth both suffer.`)
    if (this.env.illumination > 0.4)
      push('info', 'Bright light: negative phototaxis is steering the front downwards, and starved motes may sporulate.')
    if (s.toxinLoad > 0.05)
      push('bad', `Toxin load ${s.toxinLoad.toFixed(2)} - cytotoxic damage is being taken.`)

    if (this.env.gravity > 0 && s.airborne > 0) {
      const frac = s.airborne / Math.max(1, s.motes)
      if (frac > 0.25)
        push(
          'warn',
          `${s.airborne} motes are holding nothing: ${(frac * 100).toFixed(0)}% of the front is spanning open space and sagging.`,
        )
    }
    if (s.tears > 0)
      push(
        s.tears > 40 ? 'bad' : 'info',
        `${s.tears} spans have torn under their own weight. Thicken a bridge by feeding both ends, or lower gravity.`,
      )
    if (s.solids > 0 && this.env.gravity > 0) {
      const worst = this.solids.reduce(
        (lo, so) => Math.min(lo, MATERIALS[so.material].adhesion),
        1,
      )
      if (worst < 0.4)
        push(
          'info',
          `Smoothest surface in the vessel offers ${(worst * 100).toFixed(0)}% grip - expect the front to slide rather than climb it.`,
        )
    }
    if (this.foods.length === 0) push('info', 'Nothing to eat in the vessel.')
    else if (s.foodRemainingMg < 1) push('warn', 'Deposits are spent.')
    if (s.residueMg > 5)
      push(
        'info',
        `${s.residueMg.toFixed(0)} mg of indigestible residue (cellulose, chitin, lactose). No enzyme for it, so it stays on the plate.`,
      )
    if (s.growthEfficiency > 0)
      push(
        'info',
        `Growth yield ${(s.growthEfficiency * 100).toFixed(0)}% of substrate consumed; ${((this.voidedCarb + this.voidedProtein) / 1000).toFixed(2)} mg voided as surplus.`,
      )
    return d
  }
}
