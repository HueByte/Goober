/**
 * Core data types for the Goober slime-mould simulation.
 *
 * Everything nutritional is expressed the way food-composition tables express it:
 * grams per 100 g of food "as served", plus a mineral/vitamin table in mg per 100 g.
 * The simulation converts those numbers into diffusible substrate pools at runtime.
 */

/** Which glycoside bonds the sugar fraction is actually made of -- decides which enzyme is needed. */
export type SugarProfile =
  | 'glucose' // free monosaccharide, absorbed directly
  | 'fructose'
  | 'sucrose' // needs invertase
  | 'maltose' // needs maltase / amylase
  | 'lactose' // needs beta-galactosidase -- Physarum essentially lacks it
  | 'mixed'

export type EnzymeId =
  | 'amylase'
  | 'invertase'
  | 'betaGalactosidase'
  | 'protease'
  | 'lipase'
  | 'nuclease'
  | 'chitinase'
  | 'cellulase'

/** Macronutrient pools we track individually, because each has its own enzymology. */
export type MacroId =
  | 'sugars'
  | 'starch'
  | 'fiber'
  | 'protein'
  | 'freeAminoAcids'
  | 'lipid'
  | 'chitin'
  | 'nucleicAcids'
  | 'ash'
  | 'inert'
  | 'water'

/** Minerals + the two vitamins/cofactors Physarum genuinely cannot make for itself. */
export type TraceId = 'K' | 'P' | 'Mg' | 'Ca' | 'Fe' | 'Zn' | 'Na' | 'thiamine' | 'heme'

/** g per 100 g as served. Should sum to ~100. */
export type Composition = Record<Exclude<MacroId, never>, number>

/** mg per 100 g as served. */
export type Traces = Partial<Record<TraceId, number>>

export interface Toxin {
  name: string
  /** mg per 100 g of food. */
  mgPer100g: number
  /** Cytotoxicity per mg/L of local concentration, scaled in BIO.toxicity. */
  potency: number
  /** How strongly the plasmodium steers away from it (chemorepulsion). */
  repellency: number
  note: string
}

/**
 * Physical matrix of the food. Controls how fast enzymes can reach the substrate:
 * a droplet of peptone broth is fully accessible, a dry oat flake must be wetted
 * and eroded from the surface inwards, a crystal has to dissolve first, and
 * bacterial cells have to be engulfed and lysed.
 */
export type FoodMatrix = 'gel' | 'liquid' | 'powder' | 'flake' | 'solid' | 'crystal' | 'cells'

export type FoodCategory = 'classic' | 'carbohydrate' | 'protein' | 'complex' | 'defined' | 'antagonist'

/**
 * How a deposit is drawn. Physical form, not decoration: a flake is a thin
 * lamina, a crystal is a faceted prism, a lawn is a film spread over the agar.
 * Nothing is a sphere, because nothing on the menu is.
 */
export type FoodShape =
  | 'flake'
  | 'gel'
  | 'drop'
  | 'powder'
  | 'crystal'
  | 'chunk'
  | 'slice'
  | 'lawn'

export interface FoodDef {
  id: string
  name: string
  /** Short label used on the 3D marker. */
  glyph: string
  category: FoodCategory
  color: string
  /** One-line flavour text shown in the palette. */
  blurb: string
  comp: Composition
  traces: Traces
  /** pH of the food itself (the substrate buffers towards BIO.substrate.ph). */
  ph: number
  sugarProfile: SugarProfile
  matrix: FoodMatrix
  shape: FoodShape
  /** Default placed mass, milligrams. */
  defaultMassMg: number
  /** Radius of the deposit in grid units at full mass. */
  radius: number
  toxins: Toxin[]
  /** Free-text realism notes surfaced in the inspector. */
  notes: string[]
}

export interface FoodInstance {
  id: string
  defId: string
  x: number
  y: number
  z: number
  /** Remaining mass of every macro pool, in milligrams. */
  pools: Record<MacroId, number>
  /** Remaining trace pool, micrograms. */
  traces: Partial<Record<TraceId, number>>
  initialMassMg: number
  /** 0..1, how heavily the plasmodium has colonised this deposit (gates enzyme secretion). */
  colonization: number
  /** Cumulative mg that actually entered the substrate as usable nutrient. */
  assimilatedMg: number
  /** Cumulative mg locked up in residue we have no enzyme for. */
  residueMg: number
  createdAtMin: number
}

export interface SimParams {
  /** Grid resolution per axis. */
  grid: number
  maxMotes: number
  /** Simulated minutes per real-time second at 1x. */
  minutesPerSecond: number
  // --- Physarum agent behaviour ---
  sensorDistance: number
  sensorAngle: number
  sensorCount: number
  /**
   * How many steps a mote keeps its heading before sensing again. Sensing is by
   * far the most expensive thing the swarm does - a cone of samples per mote per
   * step - so staggering it across the population buys a lot of frame time for
   * very little change in behaviour. 1 senses every step.
   */
  sensorStride: number
  turnRate: number
  speed: number
  randomness: number
  depositRate: number
  trailDecayPerMin: number
  trailDiffusion: number
  /**
   * How fast an unused transport tube is reabsorbed. Tubes thicken where
   * cytoplasm actually flows and shrink where it does not, which is what leaves
   * a visible record of the paths the colony has committed to. Set it to zero to
   * keep every tube it has ever built.
   */
  veinDecayPerMin: number
  nutrientDiffusion: number
  nutrientDecayPerMin: number
  /** Relative weight of own slime trail vs. food gradient when steering. */
  trailAffinity: number
  nutrientAffinity: number
  repellentAversion: number
  /**
   * Thigmotaxis: how strongly the front spreads along any surface it can grip.
   * This is what carries a colony up the side of an object.
   */
  surfaceAffinity: number
  /**
   * How strongly the plasmodium holds together. This is the one that decides
   * whether it behaves as a single cell that morphs towards food or as a cloud
   * of independent foragers: it is one organism, and it does not send pieces of
   * itself off on their own.
   */
  cohesion: number
  /**
   * Rate of cytoplasmic streaming through the tube network. Food taken up
   * anywhere on a connected body feeds the whole of it, which is what lets the
   * colony put its mass where it is needed instead of starving in one place
   * while it feasts in another.
   */
  circulation: number
}

export interface EnvParams {
  temperatureC: number
  relativeHumidity: number
  /** pH of the blank agar the mould sits on. */
  substratePh: number
  substrateOsmolarity: number
  /** 0..1 white-light intensity from above; Physarum is negatively phototactic. */
  illumination: number
  /** Agar stiffness, 0.5 (soft) .. 3 (%w/v); affects motility. */
  agarPercent: number
  /**
   * Weight the plasmodium has to hold up, 0..2. At 0 the vessel behaves as a
   * gel that supports the colony everywhere and growth is freely
   * three-dimensional. Above 0 the colony has to grip something to climb, and
   * unsupported spans sag and tear.
   */
  gravity: number
}

export interface TraceStatus {
  id: TraceId
  label: string
  /** Colony pool, micrograms. */
  pool: number
  /** Micrograms needed for the growth the colony is currently attempting. */
  demand: number
  /** 0..1 Michaelis-style sufficiency. */
  sufficiency: number
  essential: boolean
}

export interface ColonyStats {
  timeMin: number
  motes: number
  dormant: number
  biomassMg: number
  peakBiomassMg: number
  growthRatePerHour: number
  divisions: number
  deaths: number
  /** Cumulative intake, micrograms. */
  intakeProtein: number
  intakeCarb: number
  /** Protein : carbohydrate intake ratio (the Dussutour axis). */
  pcRatio: number
  targetPcRatio: number
  limiting: 'protein' | 'carbohydrate' | 'energy' | 'micronutrient' | 'balanced' | 'none'
  /** Multipliers currently applied to growth. */
  factors: {
    temperature: number
    ph: number
    osmotic: number
    humidity: number
    balance: number
    micronutrient: number
    light: number
    total: number
  }
  substrateProteinUg: number
  substrateCarbUg: number
  networkVoxels: number
  exploredFraction: number
  /** Voxels occupied by a transport tube, i.e. cubic millimetres of vein. */
  veinVolumeMm3: number
  veinMass: number
  /** Motes currently gripping a surface, and spans that have torn. */
  adhered: number
  airborne: number
  tears: number
  solids: number
  foodRemainingMg: number
  residueMg: number
  assimilatedMg: number
  growthEfficiency: number
  meanPh: number
  meanOsmolarity: number
  toxinLoad: number
  traces: TraceStatus[]
  diagnostics: Diagnostic[]
}

export interface Diagnostic {
  level: 'ok' | 'info' | 'warn' | 'bad'
  text: string
}
