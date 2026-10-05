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
import { BRICK, ByteField3D, FIELD_EPS, Field3D, Lattice, depositSphere } from './field'
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

/**
 * Bytes of field storage per voxel. Five fields plus three masks, and the three
 * diffusible fields need a scratch buffer each.
 */
export const BYTES_PER_VOXEL = 35
/** Bytes a single 16 mm brick costs once something is written into it. */
export const BYTES_PER_BRICK = BRICK ** 3 * BYTES_PER_VOXEL

/**
 * The largest vessel edge, in millimetres.
 *
 * A metre at one millimetre is 10^9 voxels, which stored densely would be tens
 * of gigabytes. It is not stored densely: the lattice is cut into bricks and a
 * brick is paid for only once something is written into it, so an empty metre
 * costs a megabyte of brick table and nothing else. What is capped is therefore
 * not the vessel but how much of it the colony may occupy at once, and that is
 * the memory budget below.
 */
export function maxGridSize(): number {
  return 1000
}

/**
 * Default ceiling on field storage. Reaching it does not fail or restart
 * anything: writes outside the bricks already allocated are discarded, so the
 * colony simply stops being able to spread further.
 */
export const DEFAULT_FIELD_BUDGET_MB = 256

export function bricksForBudget(megabytes: number): number {
  // A save written before this setting existed has no value for it, and a NaN
  // budget is an unbounded one - so the default stands in for anything that is
  // not a usable number.
  const mb = Number.isFinite(megabytes) && megabytes > 0 ? megabytes : DEFAULT_FIELD_BUDGET_MB
  return Math.max(64, Math.floor((mb * 1048576) / BYTES_PER_BRICK))
}

export const DEFAULT_PARAMS: SimParams = {
  grid: 96,
  fieldBudgetMb: DEFAULT_FIELD_BUDGET_MB,
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
  veinDecayPerMin: 0.003,
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
  recruitment: 1.2,
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
const CONNECTION_FLOOR = 45 // ~5 nuclei packed together, not two in passing
/**
 * Biomass density, ug per voxel, at which a nucleus is fully carried by the
 * cytoplasm around it.
 *
 * A plasmodium is one cell. There is no such thing as a nucleus walking off
 * across bare agar on its own - the front advances as a sheet of cytoplasm, and
 * a nucleus goes where that cytoplasm goes. Without this the swarm advances at
 * the pace of its fastest individual rather than the pace of a body, which is
 * how deposits end up being eaten by a dust of arrivals before anything has
 * reached them.
 */
const SUPPORT_KM = 16
/** How fast a nucleus can move with no cytoplasm around it at all. */
const UNSUPPORTED_SPEED = 0.45
/**
 * Weight on the volatile attractant, relative to the substrate terms. A smell is
 * worth following, but it is a promise rather than a meal, so it is deliberately
 * cheaper per unit than the dissolved nutrient it is meant to advertise.
 */
/**
 * Biomass density, ug per voxel, at which a find stops being news.
 *
 * Measured: a signal emitted by everything that is eating rewards the status
 * quo. The body is already sitting on the food it found first, so that is where
 * the shouting comes from, and raising the volume pinned the colony harder to
 * where it already was - exactly backwards. What carries information is a find
 * the organism is *not* already exploiting, so the emission is weighted down by
 * how much of the body is there to hear it in person.
 */
const RECRUIT_CROWD = 30
/** Signal strength at which a nucleus is half as interested as it can be. */
const RECRUIT_KM = 0.06
/** Fraction of the signal lost each simulated minute. */
const RECRUIT_DECAY = 0.06
const LURE_SCALE = 2.4
/** How much of a smell counts as a find, for the purpose of getting excited. */
const LURE_EXCITE = 1.6
/** How completely a narcotic can arrest streaming. */
const NARCOSIS_SCALE = 2.2
/**
 * How far a deposit has to be worn down before what is left of it counts as
 * crumbs rather than an object.
 */
/** Satiety above which a nucleus has nothing left to look for. */
const SETTLED_SATIETY = 0.7
/** Local substrate, ug per voxel, that counts as sitting on a meal. */
const SETTLED_FOOD = 0.4
/** How often a settled nucleus looks up to see whether anything has changed. */
const SETTLED_RECHECK = 12
/** What is left of its motility: enough to pack, not enough to orbit. */
const SETTLED_DRIFT = 0.12
const RESIDUE_CLEARS = 0.25
/** How many deposits may sit on the plate at once. */
const MAX_DEPOSITS = 120
/** How fast a deposit's own water merges into the agar, against its solute. */
const WATER_DISPERSAL = 0.25
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
const VEIN_FLUX_KM = 6
const VEIN_MAX = 420
/** Tube thickness that counts as a real vein for the read-outs. */
const VEIN_VISIBLE = 8
/**
 * Tube thickness that still counts as being joined to the rest of the organism.
 * Below this the strand has been reabsorbed and whatever is on the end of it is
 * on its own.
 */
const TUBE_CONTACT = 5
/**
 * The thinnest strand the body can push out and hold open. An advancing front
 * always leaves at least this much behind it, which is what makes the route it
 * took visible from the moment it takes it.
 */
const TUBE_STRAND = 16
/** How quickly that strand is laid, per simulated minute. */
const TUBE_ADVANCE = 1.5
/**
 * How long an arm goes without finding anything before the organism starts
 * taking it back rather than merely letting it wander. Withdrawal is the other
 * half of how a plasmodium optimises: the routes that found nothing are
 * actively reabsorbed, not just left to fade.
 */
const WITHDRAW_AFTER_MIN = 110
/** How hard a withdrawing mote follows the tube network home. */
const RETRACT_WEIGHT = 3.4
/** Tube thickness at which "thicker, this way" stops being informative. */
const RETRACT_KM = 90
/**
 * Weight on actual transport when thickening a tube, against mere occupancy.
 * This is the Tero rule: a tube is reinforced by the cytoplasm flowing through
 * it, so the routes between a food source and the growing front thicken and
 * everything else is reabsorbed. Occupancy still counts for something, because
 * a deposit being fed on is a real part of the network, but it is deliberately
 * the smaller term - otherwise every place the colony sits becomes a trunk.
 */
const STREAM_GAIN = 2.6
const OCCUPANCY_GAIN = 0.45
/**
 * Weight on traffic: cytoplasm moving along an existing tube, whatever it is
 * carrying.
 *
 * This is what maintains the route between two deposits the colony is working.
 * Neither end of such a route is where the feeding happens and neither is where
 * the growing is, so nothing else in the model credits it - and a corridor that
 * nothing credits is reabsorbed under the colony's own feet. A tube is held open
 * by what passes through it, so passing through it is what holds it open.
 */
const TRANSIT_GAIN = 0.32
/** The step a mote takes in a minute at the default advance speed. */
const TRANSIT_REF = 0.12
/** Surplus store voided per minute when one currency is at capacity. */
const OVERFLOW_VOID_PER_MIN = 0.05
/** Resolution of the environmental chemistry grid. */
const ENV_GRID = 20
/**
 * Diffusion and the biomass map both run on a coarser cadence than the swarm.
 * Diffusion is linear, so accumulating several steps' worth and applying a
 * proportionally larger mixing coefficient transports the same material for a
 * fraction of the work.
 */
const DIFFUSE_EVERY = 2
const BIO_MAP_EVERY = 8
/**
 * How often tube reabsorption is applied. It is a slow exponential over hours,
 * so doing it every step is a full sweep of the network for a change of four
 * parts in a hundred thousand. Accumulated and applied on a coarse cadence it
 * is the same curve for an eighth of the work.
 */
const VEIN_DECAY_EVERY = 8
/** How often the slime trail is integrated. */
const TRAIL_EVERY = 2
/**
 * How often ground the colony has left is handed back.
 *
 * A wandering organism would otherwise cost more and more the longer it ran,
 * because every brick it ever touched stays allocated. Once a brick holds no
 * substrate, no slime, no tube, no biomass and no structure, there is nothing
 * in it to simulate or draw, and it goes back on the free list.
 */
const RECLAIM_EVERY = 400

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


/**
 * Does this solid pass through this voxel at all?
 *
 * Testing the voxel's centre is not the same question, and the difference is a
 * hole. A two-millimetre wall turned forty-five degrees occupies the right
 * number of voxels, but by centres alone those voxels only touch at their
 * corners - a staircase, not a wall - and anything moving diagonally walks
 * straight between them. Measured: zero motes crossed such a wall at yaw 0, and
 * 252 crossed the same wall at yaw 0.79.
 *
 * So the voxel is sampled on a grid fine enough that nothing the slab passes
 * through can be missed: a third of a millimetre, against the thinnest object
 * worth building. Short-circuits on the first hit, and only runs when the solids
 * change.
 */
function voxelMeetsSolid(s: SolidInstance, x: number, y: number, z: number): boolean {
  for (let k = 0; k < 3; k++) {
    const sz = z + (k + 0.5) / 3
    for (let j = 0; j < 3; j++) {
      const sy = y + (j + 0.5) / 3
      for (let i = 0; i < 3; i++) {
        if (solidContains(s, x + (i + 0.5) / 3, sy, sz)) return true
      }
    }
  }
  return false
}

export class Colony {
  params: SimParams
  env: EnvParams

  n: number
  carb!: Field3D
  prot!: Field3D
  trail!: Field3D
  /** Persistent transport tubes: thickness, not concentration. */
  vein!: Field3D
  bio!: Field3D
  envGrid!: EnvGrid

  foods: FoodInstance[] = []
  solids: SolidInstance[] = []
  /** The shared brick table. Every field below is indexed through it. */
  lattice!: Lattice
  /** 1 where a solid occupies the voxel. */
  solidMask!: ByteField3D
  /** Adhesion available at this voxel, 0..255, from any solid within one voxel. */
  gripField!: ByteField3D
  /** 1 beside a sheer object: no purchase, and no way up. */
  slipField!: ByteField3D
  /** Steps taken, used to stagger per-mote work across the swarm. */
  private stepCount = 0
  private compactAt = 0
  private pendingDiffusionMin = 0
  private pendingVeinMin = 0
  private pendingTrailMin = 0
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
   * Cytoplasm this mote exchanged with the circulating pool on the previous
   * step, micrograms. It is the only honest measure of transport available
   * here - a mote donating at a deposit and one drawing at the front are both
   * driving flow through the tube between them - and it is what the tube is
   * thickened by.
   */
  streamed!: Float32Array
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
    this.allocateFields()
    this.region = { x0: 1, y0: 1, z0: 1, x1: 1, y1: 1, z1: 1 }
    this.allocate(this.params.maxMotes)
    this.rebuildSensorTable()
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  /**
   * Field storage for the current vessel.
   *
   * Nothing here is proportional to the vessel except the brick table, so this
   * is cheap at any size; what the fields actually cost is decided later, one
   * brick at a time, by where the colony goes.
   */
  private allocateFields(): void {
    const n = this.n
    this.lattice = new Lattice(n, bricksForBudget(this.params.fieldBudgetMb))
    this.carb = new Field3D(this.lattice)
    this.prot = new Field3D(this.lattice)
    this.trail = new Field3D(this.lattice)
    this.vein = new Field3D(this.lattice, false)
    this.bio = new Field3D(this.lattice, false)
    this.solidMask = new ByteField3D(this.lattice)
    this.gripField = new ByteField3D(this.lattice)
    this.slipField = new ByteField3D(this.lattice)
    this.envGrid = new EnvGrid(ENV_GRID, n)
  }

  /** Field memory actually committed, in bytes. */
  get fieldBytes(): number {
    return this.lattice.allocatedBytes
  }

  /** True once the colony has filled its memory budget and cannot spread further. */
  get fieldBudgetReached(): boolean {
    return this.lattice.exhausted
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
    this.streamed = new Float32Array(cap)
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
    permuteF(this.streamed)
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
    // Anything restored from an older save may be missing settings this build
    // has since added.
    if (!Number.isFinite(this.params.fieldBudgetMb)) {
      this.params.fieldBudgetMb = DEFAULT_FIELD_BUDGET_MB
    }
    // The memory budget is live: it only changes how many more bricks may be
    // handed out, so there is no need to restart anything for it.
    if (p.fieldBudgetMb !== undefined && p.fieldBudgetMb !== this.params.fieldBudgetMb) {
      this.params = { ...this.params, fieldBudgetMb: p.fieldBudgetMb }
      this.lattice.maxBricks = bricksForBudget(p.fieldBudgetMb)
      if (this.lattice.count < this.lattice.maxBricks) this.lattice.exhausted = false
    }
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
    this.revision++
    this.carb.clear()
    this.prot.clear()
    this.trail.clear()
    this.vein.clear()
    this.bio.clear()
    this.foods = []
    this.solids = []
    this.lattice.reset()
    this.solidMask.clear()
    this.gripField.clear()
    this.slipField.clear()
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
    this.revision++
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
    this.revision++
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
    this.revision++
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
          const i = this.lattice.index(vx, vy, vz)
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
    return this.lattice.index(x, y, z)
  }

  isSolid(x: number, y: number, z: number): boolean {
    return this.solidMask.data[this.voxel(x, y, z)] === 1
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
    this.revision++
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
    this.revision++
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
    this.solidMask.clear()
    this.gripField.clear()
    this.slipField.clear()
    if (this.solids.length === 0) {
      this.obstacles = undefined
      return
    }
    const L = this.lattice
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
            if (!voxelMeetsSolid(s, x, y, z)) continue
            mask.data[L.cell(x, y, z)] = 1
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
                  const gi = L.cell(gx, gy, gz)
                  if (grip.data[gi] < adh) grip.data[gi] = adh
                  if (!s.climbable) slip.data[gi] = 1
                }
              }
            }
          }
        }
      }
    }

    // Every voxel that can be solid, or next to a solid, lies inside one of the
    // bounding boxes grown by a voxel - so the boundary lists are built by
    // walking those rather than the whole lattice, which at a metre would be a
    // billion voxels of mostly nothing. Overlapping objects can list a voxel
    // twice; both the stencil fix-up and the solid clamp are assignments, so a
    // duplicate costs a little work and changes nothing.
    const boundary: number[] = []
    const boundaryNb: number[] = []
    const solid: number[] = []
    const md = mask.data
    for (const s of this.solids) {
      const [bx0, by0, bz0, bx1, by1, bz1] = solidBounds(s)
      const x0 = Math.max(0, Math.floor(bx0) - 1)
      const y0 = Math.max(0, Math.floor(by0) - 1)
      const z0 = Math.max(0, Math.floor(bz0) - 1)
      const x1 = Math.min(last, Math.ceil(bx1) + 1)
      const y1 = Math.min(last, Math.ceil(by1) + 1)
      const z1 = Math.min(last, Math.ceil(bz1) + 1)
      for (let z = z0; z <= z1; z++) {
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const i = L.index(x, y, z)
            if (md[i] === 1) {
              solid.push(i)
              continue
            }
            if (grip.data[i] === 0 && slip.data[i] === 0) continue
            const xm = x > 0 ? L.index(x - 1, y, z) : i
            const xp = x < last ? L.index(x + 1, y, z) : i
            const ym = y > 0 ? L.index(x, y - 1, z) : i
            const yp = y < last ? L.index(x, y + 1, z) : i
            const zm = z > 0 ? L.index(x, y, z - 1) : i
            const zp = z < last ? L.index(x, y, z + 1) : i
            if (
              md[xm] !== 1 &&
              md[xp] !== 1 &&
              md[ym] !== 1 &&
              md[yp] !== 1 &&
              md[zm] !== 1 &&
              md[zp] !== 1
            )
              continue
            boundary.push(i)
            boundaryNb.push(xm, xp, ym, yp, zm, zp)
          }
        }
      }
    }
    this.obstacles = {
      mask: mask.data,
      boundary: Int32Array.from(boundary),
      boundaryNb: Int32Array.from(boundaryNb),
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
    const last = n - 1
    const L = this.lattice
    const mask = this.solidMask.data
    const ix = Math.min(last, Math.max(0, Math.floor(x)))
    const iy = Math.min(last, Math.max(0, Math.floor(y)))
    const iz = Math.min(last, Math.max(0, Math.floor(z)))
    let ax = 0
    let ay = 0
    let az = 0
    if (ix > 0 && mask[L.index(ix - 1, iy, iz)]) ax += 1
    if (ix < last && mask[L.index(ix + 1, iy, iz)]) ax -= 1
    if (iy > 0 && mask[L.index(ix, iy - 1, iz)]) ay += 1
    if (iy < last && mask[L.index(ix, iy + 1, iz)]) ay -= 1
    if (iz > 0 && mask[L.index(ix, iy, iz - 1)]) az += 1
    if (iz < last && mask[L.index(ix, iy, iz + 1)]) az -= 1
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
    this.revision++
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
    // A plate can only hold so many deposits before it is clutter rather than an
    // experiment - and every one of them is a term in the environmental
    // chemistry, rebuilt every simulated minute. Past the cap the oldest goes,
    // which over a long drip feed means the ones the colony never came back for.
    if (this.foods.length >= MAX_DEPOSITS) {
      let oldest = 0
      for (let k = 1; k < this.foods.length; k++) {
        if (this.foods[k].createdAtMin < this.foods[oldest].createdAtMin) oldest = k
      }
      this.spentResidueMg += foodResidueMg(this.foods[oldest])
      this.foods.splice(oldest, 1)
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
    this.revision++
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
  scatterFood(
    defIds: string | string[],
    count: number,
    massMg?: number | ((defId: string) => number | undefined),
    pad = 14,
  ): number {
    // A list is drawn from at random, one pick per deposit, so a mixed scatter
    // can drop a salt crystal beside an oat flake the way a real plate ends up
    // with whatever happened to land on it.
    const pool = typeof defIds === 'string' ? [defIds] : defIds
    if (pool.length === 0) return 0
    let made = 0
    // Food the colony cannot find does not maintain anything, so the scatter is
    // drawn around where it currently is, with enough margin to still draw it
    // outwards. With nothing alive, use the whole plate.
    const alive = this.motes + this.dormantCount > 0
    const r = this.region
    const x0 = alive ? Math.max(3, r.x0 - pad) : 3
    const x1 = alive ? Math.min(this.n - 3, r.x1 + pad) : this.n - 3
    const z0 = alive ? Math.max(3, r.z0 - pad) : 3
    const z1 = alive ? Math.min(this.n - 3, r.z1 + pad) : this.n - 3
    for (let i = 0; i < count; i++) {
      const x = x0 + Math.random() * (x1 - x0)
      const z = z0 + Math.random() * (z1 - z0)
      // Search from the ceiling so it finds the highest surface in the column.
      const y = this.surfaceBelow(x, this.n - 2, z) + 1
      const pick = pool[(Math.random() * pool.length) | 0]
      const mass = typeof massMg === 'function' ? massMg(pick) : massMg
      if (this.addFood(pick, x, y, z, mass)) made++
    }
    return made
  }

  /**
   * Drop deposits in a ring beyond the colony's own edge.
   *
   * A scatter inside the footprint feeds the colony where it already is, which
   * keeps it alive and keeps it still. Putting the food past the edge is what
   * makes it travel, which is the whole point of a drip feed: the network has to
   * keep being rebuilt towards wherever the next meal landed.
   */
  scatterBeyond(
    defIds: string | string[],
    count: number,
    reach: number,
    massMg?: number | ((defId: string) => number | undefined),
  ): number {
    const pool = typeof defIds === 'string' ? [defIds] : defIds
    if (pool.length === 0) return 0
    const r = this.region
    const alive = this.motes + this.dormantCount > 0
    if (!alive) return this.scatterFood(pool, count, massMg)
    const cx = (r.x0 + r.x1) / 2
    const cz = (r.z0 + r.z1) / 2
    // The colony's own half-width, so "beyond" means beyond.
    const edge = Math.max(2, Math.max(r.x1 - r.x0, r.z1 - r.z0) / 2)
    // One direction for the whole drop, not one per deposit. A ring of food
    // around the colony pulls it equally every way and it stays where it is;
    // a patch of food somewhere pulls it somewhere, which is the point.
    let bearing = Math.random() * Math.PI * 2
    let px = cx
    let pz = cz
    for (let attempt = 0; attempt < 10; attempt++) {
      const d = edge + Math.random() * Math.max(1, reach)
      px = cx + Math.cos(bearing) * d
      pz = cz + Math.sin(bearing) * d
      if (px > 4 && px < this.n - 4 && pz > 4 && pz < this.n - 4) break
      bearing = Math.random() * Math.PI * 2
      px = cx
      pz = cz
    }
    const spread = Math.max(3, reach * 0.3)
    let made = 0
    for (let i = 0; i < count; i++) {
      const x = clamp(px + (Math.random() - 0.5) * spread * 2, 3, this.n - 3)
      const z = clamp(pz + (Math.random() - 0.5) * spread * 2, 3, this.n - 3)
      const y = this.surfaceBelow(x, this.n - 2, z) + 1
      const pick = pool[(Math.random() * pool.length) | 0]
      const mass = typeof massMg === 'function' ? massMg(pick) : massMg
      if (this.addFood(pick, x, y, z, mass)) made++
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
      // When a deposit is finished with.
      //
      // Not when there is nothing edible left in it - that was the old test and
      // it was wrong, because it is a statement about food rather than about the
      // deposit. A salt crystal was never edible, so it was deleted the instant
      // it was placed; a tincture that has given up its trace of sugar is still
      // 92% of a drop and was deleted with all of it still there.
      //
      // So: a deposit goes when there is physically nothing left of it, or when
      // what remains is residue no enzyme can touch *and* there is little enough
      // of it to be dispersed rather than sat on. A spent oat flake leaves
      // crumbs, and crumbs go. A cellulose pad is 92% residue and stays, which
      // is the whole point of a cellulose pad.
      const spent = this.usableMassMg(f) < 0.04 && mass < f.initialMassMg * RESIDUE_CLEARS
      if (mass <= 1e-4 || spent) {
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
      // Water goes with the rest of the deposit, and also on its own: a drop
      // left on agar equilibrates with it whether or not anything is eating.
      // Without this a deposit that is mostly water and nothing else - a plain
      // agar control, a vinegar drop - would sit on the plate for ever.
      // Slower than the solute, because the water does not really go anywhere:
      // a drop merges with the agar rather than evaporating off it, and what is
      // actually left behind is its solute at a lower concentration. Using the
      // solute's own rate here makes a vinegar drop vanish in an afternoon.
      const waterLoss = Math.max(relFrac, leach * access * WATER_DISPERSAL * dt)
      if (waterLoss > 0) {
        f.pools.water = Math.max(0, f.pools.water * (1 - waterLoss))
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
      const since = Math.min(30, Math.max(0.01, this.timeMin - this.envRebuiltAt))
      this.envGrid.rebuild(this.foods, E)
      this.envGrid.stepRecruit(1 - Math.exp(-RECRUIT_DECAY * since))
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
      // Cytoplasm carrying this nucleus: what shares its voxel, or what is just
      // behind it along the way it came. A tip at the leading edge is pushed
      // from behind - that is how a pseudopod works - so taking only what is
      // underneath it would cripple the advancing front while doing nothing
      // about the thing that actually needs stopping, which is a nucleus with
      // the organism nowhere near it.
      const behindSupport = this.bio.nearest(
        x - this.dx[i] * 1.5,
        y - this.dy[i] * 1.5,
        z - this.dz[i] * 1.5,
      )
      const here2 = this.bio.nearest(x, y, z) - bm
      const around = here2 > behindSupport ? here2 : behindSupport
      // An arm that has been failing long enough is taken back rather than left
      // to wander: the mote turns round and follows the tube uphill, towards
      // thicker network and so towards wherever the colony is actually feeding.
      // It also stops holding its own tube open, so the route it came out on is
      // reabsorbed behind it as it goes.
      const withdrawing = this.starveMin[i] > WITHDRAW_AFTER_MIN && sat < 0.22
      const here = this.voxel(x, y, z)
      const gripHere = this.gripField.data[here] / 255
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
      // Settled nuclei.
      //
      // A nucleus sitting in the middle of a deposit it is full from, packed in
      // with the rest of the body, has nothing to decide. Running the sensor
      // cone for it costs several field samples a step to produce a jitter that
      // reads as orbiting rather than as feeding - expensive, and worse to look
      // at than simply sitting there. So it stops steering until something
      // changes, and looks up every so often in case something has.
      const settled =
        sat > SETTLED_SATIETY &&
        around > CROWDING_LIMIT * 0.6 &&
        this.carb.nearest(x, y, z) + this.prot.nearest(x, y, z) > SETTLED_FOOD
      const senses =
        (stride === 1 || i % stride === phase) &&
        (!settled || (this.stepCount + i) % SETTLED_RECHECK === 0)
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
      const retract = withdrawing ? RETRACT_WEIGHT : 0
      const cohesion = P.cohesion * (0.3 + 0.95 * sat) * (withdrawing ? 2.2 : 1)
      // A hungry nucleus answers the call; a full one has no reason to.
      const recruitPull = P.recruitment * P.nutrientAffinity * (0.25 + 1.1 * (1 - sat))
      const novelty = withdrawing
        ? 0
        : beside
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
        // Volatiles. Smelt far beyond anything the deposit has actually put into
        // solution, which is what lets the colony set off towards something it
        // has no other way of knowing is there - and what lets a lure work.
        const vol = this.envGrid.lureAt(qx, qy, qz)
        // Where the organism is already feeding. This is the only term a mote
        // reads that was written by another mote on purpose.
        const call = this.envGrid.recruitAt(qx, qy, qz)
        // Thigmotaxis: a wettable surface is worth following, which is how the
        // front gets up the side of things instead of only around them.
        const surf =
          surfaceSeek === 0
            ? 0
            : surfaceSeek * (this.gripField.data[this.voxel(qx, qy, qz)] / 255)
        // Cohesion: stay part of the organism. This is what makes the colony a
        // single mass that bulges towards food, rather than a spray of
        // independent branches wandering off in all directions.
        const body = cohesion === 0 ? 0 : cohesion * michaelis(this.bio.nearest(qx, qy, qz), COHESION_KM)
        // Novelty. An established tube is for transport, not for searching, so a
        // hungry front prefers ground it has not already worked over. This is
        // what carries the front up and around an object instead of leaving it
        // circling the base of it.
        const vn = novelty === 0 && retract === 0 ? 0 : this.vein.nearest(qx, qy, qz)
        const stale = novelty === 0 ? 0 : novelty * michaelis(vn, 25)
        // The way home. Thicker tube means closer to the working part of the
        // network, so climbing that gradient is how an arm gets reabsorbed into
        // the body instead of simply starving where it stands.
        const home = retract === 0 ? 0 : retract * michaelis(vn, RETRACT_KM)
        // Square-root compression: concentrations span several orders of
        // magnitude, and argmax over raw values would let one term swamp the rest.
        let score =
          surf +
          body +
          home -
          stale +
          P.trailAffinity * TRAIL_WEIGHT * michaelis(tr, TRAIL_KM) +
          P.nutrientAffinity * (appC * Math.sqrt(c) + appP * Math.sqrt(p)) +
          P.nutrientAffinity * LURE_SCALE * vol +
          recruitPull * michaelis(call, RECRUIT_KM) -
          aversion * REPEL_SCALE * this.envGrid.repelAt(qx, qy, qz) -
          LIGHT_SCALE * lightBias * sy
        // Search commitment: a hungry front pushes on rather than dithering.
        if (j < 0) score += persistence
        // Keep away from the vessel wall.
        if (qx < lo || qx > hi || qy < lo || qy > hi || qz < lo || qz > hi) score -= 8
        if (score > bestScore) {
          bestScore = score
          bestNutrient = appC * c + appP * p + LURE_EXCITE * vol
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
      const sheer = this.slipField.data[here] === 1
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
        // Narcotics do not poison the plasmodium, they detune the calcium
        // oscillator that drives the contraction. Streaming slows, and the mote
        // is left sitting in the stuff it would rather be walking out of.
        1 /
          (1 +
            NARCOSIS_SCALE * this.envGrid.narcoticAt(x, y, z)) *
        (cold ? 0.02 : Math.max(0.15, tempF))
      // How much of the organism is here to carry this nucleus forward. The
      // front therefore advances at the speed of the mass, and the mass arrives
      // before the feeding does.
      const carried = michaelis(around, SUPPORT_KM)
      const stepLen =
        P.speed *
        motility *
        dt *
        4 *
        (UNSUPPORTED_SPEED + (1 - UNSUPPORTED_SPEED) * carried) *
        // A nucleus that is feeding stays where the food is.
        (settled ? SETTLED_DRIFT : 1)
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
            const ti = this.trail.cell(x, y, z)
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
        const vi = this.vein.cell(nx, ny, nz)
        let have = this.vein.data[vi]
        // Is this nucleus still part of the organism? Either it is standing in
        // the body itself, or it came off the end of a tube that leads back to
        // it. Nothing else counts: a plasmodium is one cell, and a nucleus that
        // has lost the cytoplasm is not a colony in its own right.
        const behind = this.vein.nearest(x, y, z)
        const inBody = this.bio.nearest(nx, ny, nz) - bm > CONNECTION_FLOOR
        const joined = inBody || behind > TUBE_CONTACT
        if (joined) {
          // An advancing pseudopod drags a tube behind it, because the cytoplasm
          // streaming out to the tip has to flow through something. The organism
          // pays for that out of the body, not out of whatever the tip has
          // managed to eat - which is the whole reason a front crossing bare
          // agar leaves a continuous, visible thread back to where it came from
          // instead of turning up at the far food out of nowhere.
          // Only a strand, never more: thickness has to be earned by carrying
          // something. Letting the strand inherit the thickness behind it looks
          // right for a few hours and then spreads the trunk over the whole
          // plate, which is the opposite of a network.
          //
          // And a mote on its way home holds nothing open. That is what makes a
          // failed arm visibly disappear: the mass leaves, and the tube it was
          // in is no longer being maintained, so it is reabsorbed behind it.
          if (!withdrawing && have < TUBE_STRAND) {
            // The strand itself is not charged for. It is the membrane closing
            // around cytoplasm that has already gone there, not new structure,
            // and making a starving scout pay for it simply stops the organism
            // being able to explore at all.
            have += (TUBE_STRAND - have) * Math.min(1, TUBE_ADVANCE * dt)
            this.vein.data[vi] = have
            this.vein.touch(vi, have)
          }
        }
        // Thickening on top of that. Flux is the cytoplasm this mote is actually
        // carrying, so a route that keeps delivering food keeps a fat tube and
        // the rest stay threads. A stray nucleus thickens nothing.
        if (joined) {
          // Occupancy is worth a little - a deposit being fed on is genuinely
          // part of the network - but what actually builds a tube is the
          // cytoplasm going through it, which is the streaming this mote did.
          // Traffic only maintains a tube that is already there: a mote walking
          // over bare agar is not flow through anything.
          const transit =
            have > TUBE_CONTACT ? (TRANSIT_GAIN * bm * stepLen) / TRANSIT_REF : 0
          const flux =
            (OCCUPANCY_GAIN * bm * Math.max(0, sat - 0.12) +
              (STREAM_GAIN * this.streamed[i]) / Math.max(dt, 1e-6) +
              transit) *
            (1 - 0.8 * fear)
          // Hill kinetics rather than plain saturation. With a first-order
          // response every part of a broad front saturates at much the same
          // thickness and the network comes out as rivers; squaring it separates
          // the voxels that are genuinely carrying the traffic from the ones
          // merely next to them, which is what makes a vein a cord.
          const f2 = flux * flux
          const grown =
            have +
            VEIN_GAIN * (f2 / (f2 + VEIN_FLUX_KM * VEIN_FLUX_KM)) * (1 - have / VEIN_MAX) * dt
          this.vein.data[vi] = grown
          this.vein.touch(vi, grown)
        }
      }

      // ------------------------------------------------------------------
      // Uptake: Michaelis-Menten, capped by remaining store capacity.
      // ------------------------------------------------------------------
      // How much of a discovery this is: everything, for a scout on its own on
      // fresh substrate; almost nothing, for one more nucleus in a mass already
      // feeding, which has no one left to tell.
      const news = 1 / (1 + Math.max(0, around) / RECRUIT_CROWD)
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
        // Tell the rest of the organism - loudly if this is somewhere new.
        this.envGrid.addRecruit(nx, ny, nz, got * news)
      }
      if (roomP > 0 && pHere > 0) {
        const want = Math.min(
          roomP,
          K.vmaxProtein * scale * michaelis(pHere, BIO.kinetics.kmProtein) * dt * osmoF,
        )
        const got = this.prot.take(nx, ny, nz, want)
        ps += got
        this.intakeProtein += got
        this.envGrid.addRecruit(nx, ny, nz, got * news)
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
      // Same oscillator, same consequence: cytoplasm is pumped by the
      // contraction, so a narcotised stretch of network stops delivering.
      // Flow through a tube rises with its bore, so a thin exploratory strand
      // carries far less than an established vein. Measured, a steeper law than
      // this starves the network before it can build itself: thickening is
      // driven by streaming, so if nothing streams, nothing thickens, and the
      // colony never gets a transport system at all.
      const conductance =
        michaelis(this.vein.nearest(nx, ny, nz), CONDUCTANCE_KM) /
        (1 + NARCOSIS_SCALE * this.envGrid.narcoticAt(nx, ny, nz))
      let streamed = 0
      if (conductance > 0.02 && P.circulation > 0) {
        const rate = Math.min(0.9, P.circulation * conductance * dt * 4)
        const wantC = CIRCULATION_TARGET * capC
        if (cs > wantC) {
          const give = (cs - wantC) * rate
          cs -= give
          this.circulatingCarb += give
          streamed += give
        } else {
          const take = Math.min((wantC - cs) * rate, this.circulatingCarb)
          cs += take
          this.circulatingCarb -= take
          streamed += take
        }
        const wantP = CIRCULATION_TARGET * capP
        if (ps > wantP) {
          const give = (ps - wantP) * rate
          ps -= give
          this.circulatingProtein += give
          streamed += give
        } else {
          const take = Math.min((wantP - ps) * rate, this.circulatingProtein)
          ps += take
          this.circulatingProtein -= take
          streamed += take
        }
      }
      this.streamed[i] = streamed

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
      const neighbours = this.bio.nearest(nx, ny, nz) - bm
      const crowded = neighbours > CROWDING_LIMIT
      const connected = neighbours > CONNECTION_FLOOR
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
    this.pendingVeinMin += dt
    if (P.veinDecayPerMin > 0 && this.stepCount % VEIN_DECAY_EVERY === VEIN_DECAY_EVERY - 1) {
      const keep = Math.exp(-P.veinDecayPerMin * this.pendingVeinMin)
      this.pendingVeinMin = 0
      const vd = this.vein.data
      const cells = BRICK ** 3
      const maxes = this.vein.brickMax
      this.lattice.forEachBrickIn(region, (slot) => {
        // Nothing to reabsorb in a brick with no tube in it.
        if (maxes[slot] < FIELD_EPS) return
        const base = slot * cells
        let max = 0
        for (let k = 0; k < cells; k++) {
          const v = (vd[base + k] *= keep)
          if (v > max) max = v
        }
        maxes[slot] = max < FIELD_EPS ? 0 : max
      })
    }
    const obstacles = this.obstacles
    // The slime trail is what the swarm steers by, and the fine structure of the
    // network lives in it, so it is integrated every step. The nutrient plumes
    // are smooth and slow, and run on the coarse cadence.
    // The slime trail is what the swarm steers by, so it was integrated every
    // step. It does not need to be: diffusion is linear, so two steps' worth
    // applied at once transports the same material, and the trail changes over
    // minutes while the swarm is sampling it every quarter-minute. Measured, the
    // colony cannot tell the difference and it is half the work.
    this.pendingTrailMin += dt
    if (this.stepCount % TRAIL_EVERY === TRAIL_EVERY - 1) {
      const acc = this.pendingTrailMin
      this.pendingTrailMin = 0
      this.trail.step(
        clamp(P.trailDiffusion * (acc / FIXED_STEP_MIN), 0, 1),
        1 - Math.exp(-P.trailDecayPerMin * acc),
        region,
        obstacles,
      )
    }
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
    if (this.stepCount % RECLAIM_EVERY === 0) this.reclaimBricks()
  }

  /**
   * Hand back the ground the colony has finished with.
   *
   * A brick that holds no substrate, no slime, no tube, no biomass and no
   * structure has nothing in it to integrate or to draw, so it goes back on the
   * free list and the next brick the organism reaches into reuses the memory.
   * Without this, a colony that crosses a large vessel keeps paying for
   * everywhere it has ever been.
   */
  private reclaimBricks(): void {
    const floats = [this.carb, this.prot, this.trail, this.vein, this.bio]
    const bytes = [this.solidMask, this.gripField, this.slipField]
    const doomed: number[] = []
    this.lattice.forEachBrick((slot) => {
      for (const f of floats) if (f.rescanBrick(slot) >= FIELD_EPS) return
      for (const b of bytes) if (b.anyNonZero(slot)) return
      doomed.push(slot)
    })
    for (const slot of doomed) this.lattice.release(slot)
    if (doomed.length > 0) this.reclaimed += doomed.length
  }

  /** Bricks handed back over the colony's life, for the read-out. */
  reclaimed = 0
  /**
   * Bumped whenever the contents of the vessel change - an object placed or
   * removed, a deposit added, the swarm seeded or wiped. The autosave watches
   * it, because building a map is something people do with the clock stopped
   * and a save that only runs while the clock is going would never see it.
   */
  revision = 0

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
