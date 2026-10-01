/**
 * The organism model: Physarum polycephalum, plasmodial stage.
 *
 * Numbers here are chosen to be defensible rather than exact - they are the
 * textbook values for this organism where textbook values exist:
 *
 *  - Optimal growth near 24-27 C, sharply inhibited above 30 C, dormant below ~8 C.
 *  - Axenic culture wants an acidic medium, around pH 4.6-5.5.
 *  - Axenic medium must supply haematin (porphyrin iron) and thiamine: the
 *    plasmodium cannot synthesise either. Daniel and Baldwin's classic
 *    semi-defined medium is built around exactly that requirement.
 *  - Intake target is roughly 2 parts protein to 1 part carbohydrate by mass,
 *    the optimum measured by Dussutour and colleagues with nutritional-geometry
 *    experiments on this species.
 *  - It secretes amylase and proteases abundantly, has modest lipase activity,
 *    and has essentially no cellulase: cellulose is a permanent residue.
 *  - It is negatively phototactic, and light plus starvation pushes it towards
 *    sporulation rather than growth.
 */

import type { EnzymeId, FoodMatrix, MacroId, SugarProfile, TraceId } from './types'

export const BIO = {
  organism: 'Physarum polycephalum',

  /** Stoichiometry of making new plasmodium, per microgram of dry biomass. */
  biomass: {
    proteinEqPerUg: 1.3,
    carbEqPerUg: 0.65,
    /** Carbon burned purely to power anabolism (not incorporated). */
    anabolicOverhead: 0.4,
    /** Fraction of dry biomass made of each trace element / cofactor. */
    traceFraction: {
      K: 2.5e-2,
      P: 1.2e-2,
      Mg: 3.0e-3,
      Ca: 1.5e-3,
      Na: 6.0e-4,
      Fe: 2.0e-4,
      Zn: 1.0e-4,
      thiamine: 6.0e-6,
      heme: 2.5e-5,
    } as Record<TraceId, number>,
    /** Cofactors the organism cannot synthesise at all: an empty pool stops growth. */
    essentialTraces: ['thiamine', 'heme', 'K', 'P', 'Mg'] as TraceId[],
    /**
     * Fraction of the minerals and cofactors in biomass that is recovered when
     * that biomass is broken back down. Autophagy really does salvage them,
     * which is why a culture does not die the moment its haematin runs out - it
     * simply cannot get any bigger than the supply it already holds.
     */
    traceRecovery: 0.88,
  },

  /** Membrane transport, per mote, per simulated minute, at the reference biomass. */
  kinetics: {
    referenceBiomassUg: 10,
    vmaxCarb: 0.1,
    vmaxProtein: 0.075,
    /**
     * Michaelis constants in micrograms per voxel. One voxel is a cubic
     * millimetre, i.e. a microlitre, so 0.15 ug/voxel is 0.15 g/L - a bit under
     * a millimolar for a hexose. That is the high-affinity uptake a surface
     * feeder needs in order to live off a dilute diffusion plume.
     */
    kmCarb: 0.15,
    kmProtein: 0.1,
    /** Maintenance respiration, ug carbon-equivalent per ug biomass per minute. */
    maintenance: 0.0013,
    /** Biomass lost per ug of unmet maintenance demand (autophagy is lossy). */
    autophagyCost: 1.2,
    /** Protein catabolised to cover an energy deficit, at a conversion penalty. */
    proteinToCarbEfficiency: 0.55,
    /** Max specific growth rate: ln2 / 240 min, i.e. a 4 h doubling. */
    muMax: Math.LN2 / 240,
    storeCapacityCarb: 0.35,
    storeCapacityProtein: 0.5,
  },

  /** Life history of one mote (a coarse-grained packet of plasmodium). */
  life: {
    seedBiomassUg: 10,
    divideBiomassUg: 22,
    dormancyBiomassUg: 4,
    deathBiomassUg: 2,
    /**
     * Minutes of unmet maintenance before encysting as a sclerotium. Long enough
     * to cross a plate looking for the next meal, short enough that a colony
     * with nothing to eat withdraws and dies rather than creeping on forever.
     */
    starvationToDormancyMin: 260,
    /** Minutes a sclerotium survives with nothing to eat. */
    dormantLifespanMin: 900,
    /** Substrate concentration (ug/voxel) that wakes a sclerotium. */
    wakeThreshold: 12,
  },

  optimum: {
    temperatureC: 26,
    ph: 5.2,
    osmolarityMosm: 150,
    relativeHumidity: 95,
    /** Protein fraction of total intake mass. 2:1 protein:carb is 0.667. */
    proteinIntakeFraction: 2 / 3,
  },

  tolerance: {
    /** Q10 for metabolic rate below the optimum. */
    q10: 2.2,
    /** Gaussian width of the heat-inhibition limb, degrees C. */
    heatWidth: 4.5,
    heatDamageAboveC: 33,
    coldDormancyBelowC: 8,
    phWidth: 1.3,
    /** mOsm above the optimum before growth starts falling off. */
    osmoWidth: 420,
    osmoDamageAbove: 650,
    desiccationBelowRh: 65,
    /** Width of the nutritional-geometry penalty around the 2:1 target. */
    balanceWidth: 0.17,
  },

  toxicity: {
    /** Biomass fraction lost per minute per unit of toxin load. */
    damagePerLoadMin: 0.02,
    /** Motility penalty per unit of toxin load. */
    motilityPenalty: 0.55,
  },

  light: {
    /** Growth penalty at full illumination. */
    growthPenalty: 0.25,
    /** Steering bias away from the lamp. */
    phototaxis: 1.0,
    /** Starved and illuminated plasmodium commits to sporulation and is lost. */
    sporulationPerMin: 0.0035,
  },

  /** Diffusion in agar, expressed as a per-step lattice mixing coefficient. */
  transport: {
    /**
     * Stokes-Einstein: D scales with 1/r, and r with the cube root of molar mass.
     * Glucose (180 g/mol) is the reference; a peptide mix averages ~500 g/mol.
     */
    carbMolarMass: 180,
    proteinMolarMass: 500,
    /** Water viscosity falls ~2.4% per degree C, so D rises with temperature. */
    viscosityPerC: 0.024,
  },
} as const

export const ENZYMES: Record<EnzymeId, { label: string; capability: number; note: string }> = {
  amylase: {
    label: 'alpha-amylase',
    capability: 0.95,
    note: 'Secreted abundantly; hydrolyses alpha-1,4 glucan to maltose and glucose.',
  },
  invertase: {
    label: 'invertase',
    capability: 0.9,
    note: 'Splits sucrose into glucose and fructose at the cell surface.',
  },
  betaGalactosidase: {
    label: 'beta-galactosidase',
    capability: 0.04,
    note: 'Effectively absent. Lactose passes through almost untouched - milk sugar is not food.',
  },
  protease: {
    label: 'acid proteases',
    capability: 0.85,
    note: 'Slime-secreted proteases cleave intact protein to peptides and amino acids.',
  },
  lipase: {
    label: 'lipase',
    capability: 0.45,
    note: 'Modest activity. Triglyceride is energy-dense but slow to mobilise.',
  },
  nuclease: {
    label: 'nucleases',
    capability: 0.7,
    note: 'RNA and DNA yield nitrogenous bases plus pentose sugars.',
  },
  chitinase: {
    label: 'chitinase',
    capability: 0.12,
    note: 'Weak. Insect cuticle is mostly indigestible packaging.',
  },
  cellulase: {
    label: 'cellulase',
    capability: 0.0,
    note: 'None. Beta-1,4 cellulose is permanent residue - fibre is ballast, not calories.',
  },
}

/** Which enzyme, if any, gates each macronutrient pool. */
export function enzymeFor(macro: MacroId, sugar: SugarProfile): EnzymeId | null {
  switch (macro) {
    case 'sugars':
      if (sugar === 'glucose' || sugar === 'fructose') return null
      if (sugar === 'sucrose') return 'invertase'
      if (sugar === 'lactose') return 'betaGalactosidase'
      if (sugar === 'maltose') return 'amylase'
      return 'invertase'
    case 'starch':
      return 'amylase'
    case 'fiber':
      return 'cellulase'
    case 'protein':
      return 'protease'
    case 'freeAminoAcids':
      return null
    case 'lipid':
      return 'lipase'
    case 'chitin':
      return 'chitinase'
    case 'nucleicAcids':
      return 'nuclease'
    default:
      return null
  }
}

/** How easily secreted enzyme reaches the substrate inside each physical matrix. */
export const MATRIX: Record<FoodMatrix, { access: number; leach: number; label: string }> = {
  gel: { access: 1.0, leach: 0.0035, label: 'agar gel' },
  liquid: { access: 1.0, leach: 0.005, label: 'liquid' },
  powder: { access: 0.85, leach: 0.003, label: 'powder' },
  flake: { access: 0.6, leach: 0.002, label: 'dry flake' },
  solid: { access: 0.45, leach: 0.0008, label: 'solid tissue' },
  crystal: { access: 0.3, leach: 0.003, label: 'crystal' },
  cells: { access: 0.5, leach: 0.0004, label: 'intact cells' },
}

/**
 * Conversion of each macro pool into the two diffusible substrate currencies.
 * carbEq is carbon/energy (glucose equivalents), proteinEq is reduced nitrogen.
 */
export const MACRO_YIELD: Record<MacroId, { carbEq: number; proteinEq: number; label: string }> = {
  sugars: { carbEq: 1.0, proteinEq: 0, label: 'sugars' },
  // starch + water gives glucose: 162 g of glucan yields 180 g of glucose.
  starch: { carbEq: 1.11, proteinEq: 0, label: 'starch' },
  fiber: { carbEq: 1.11, proteinEq: 0, label: 'fibre' },
  protein: { carbEq: 0, proteinEq: 1.0, label: 'protein' },
  freeAminoAcids: { carbEq: 0, proteinEq: 1.0, label: 'peptides / amino acids' },
  // Energetic equivalence: 9 kcal/g fat against 4 kcal/g carbohydrate.
  lipid: { carbEq: 2.25, proteinEq: 0, label: 'lipid' },
  // N-acetylglucosamine is an amino sugar: both a hexose and a nitrogen source.
  chitin: { carbEq: 0.55, proteinEq: 0.3, label: 'chitin' },
  // Bases give nitrogen, the ribose backbone gives carbon.
  nucleicAcids: { carbEq: 0.35, proteinEq: 0.45, label: 'nucleic acids' },
  ash: { carbEq: 0, proteinEq: 0, label: 'minerals' },
  inert: { carbEq: 0, proteinEq: 0, label: 'inert / non-nutritive' },
  water: { carbEq: 0, proteinEq: 0, label: 'water' },
}

/** Elemental composition, used for the C:N and energy readouts. */
export const MACRO_ELEMENTS: Record<MacroId, { C: number; N: number; kcalPerG: number }> = {
  sugars: { C: 0.4, N: 0, kcalPerG: 3.87 },
  starch: { C: 0.44, N: 0, kcalPerG: 4.2 },
  fiber: { C: 0.44, N: 0, kcalPerG: 2.0 },
  protein: { C: 0.53, N: 0.16, kcalPerG: 4.0 },
  freeAminoAcids: { C: 0.47, N: 0.14, kcalPerG: 4.0 },
  lipid: { C: 0.77, N: 0, kcalPerG: 9.0 },
  chitin: { C: 0.47, N: 0.069, kcalPerG: 2.0 },
  nucleicAcids: { C: 0.34, N: 0.15, kcalPerG: 2.0 },
  ash: { C: 0, N: 0, kcalPerG: 0 },
  inert: { C: 0, N: 0, kcalPerG: 0 },
  water: { C: 0, N: 0, kcalPerG: 0 },
}

/** Average molar mass of the sugar fraction, for osmolarity. */
export function sugarMolarMass(profile: SugarProfile): number {
  switch (profile) {
    case 'glucose':
    case 'fructose':
      return 180
    case 'sucrose':
    case 'maltose':
    case 'lactose':
      return 342
    default:
      return 250
  }
}

export const TRACE_LABEL: Record<TraceId, string> = {
  K: 'potassium',
  P: 'phosphorus',
  Mg: 'magnesium',
  Ca: 'calcium',
  Fe: 'iron',
  Zn: 'zinc',
  Na: 'sodium',
  thiamine: 'thiamine (B1)',
  heme: 'haematin (haem Fe)',
}

export const TRACE_MOLAR_MASS: Partial<Record<TraceId, number>> = {
  K: 39.1,
  Na: 23.0,
  Mg: 24.3,
  Ca: 40.1,
  P: 31.0,
}

// ---------------------------------------------------------------------------
// Response curves
// ---------------------------------------------------------------------------

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
export const saturate = (v: number) => clamp(v, 0, 1)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const michaelis = (s: number, km: number) => (s <= 0 ? 0 : s / (km + s))

/** Q10 rise to the optimum, Gaussian heat-inhibition limb above it. */
export function temperatureFactor(tC: number): number {
  const { temperatureC } = BIO.optimum
  const { q10, heatWidth, coldDormancyBelowC } = BIO.tolerance
  if (tC <= coldDormancyBelowC) return 0
  if (tC <= temperatureC) {
    const f = Math.pow(q10, (tC - temperatureC) / 10)
    // Fade to zero across the last two degrees before dormancy.
    return f * saturate((tC - coldDormancyBelowC) / 2)
  }
  const d = (tC - temperatureC) / heatWidth
  return Math.exp(-d * d)
}

/** Heat damage above ~33 C, as a biomass loss fraction per minute. */
export function heatDamagePerMin(tC: number): number {
  const over = tC - BIO.tolerance.heatDamageAboveC
  return over <= 0 ? 0 : 0.004 * over * over
}

export function phFactor(ph: number): number {
  if (ph < 3 || ph > 9.5) return 0
  const d = (ph - BIO.optimum.ph) / BIO.tolerance.phWidth
  return Math.exp(-0.5 * d * d)
}

export function osmoticFactor(mosm: number): number {
  const excess = mosm - BIO.optimum.osmolarityMosm
  if (excess <= 0) {
    // A very dilute substrate is mildly hypotonic but tolerable.
    return clamp(0.85 + mosm / (BIO.optimum.osmolarityMosm * 6), 0, 1)
  }
  const d = excess / BIO.tolerance.osmoWidth
  return Math.exp(-d * d)
}

export function osmoticDamagePerMin(mosm: number): number {
  const over = mosm - BIO.tolerance.osmoDamageAbove
  return over <= 0 ? 0 : 0.0006 * Math.sqrt(over) * (over / 500)
}

export function humidityFactor(rh: number): number {
  const below = BIO.tolerance.desiccationBelowRh
  if (rh >= below) return 1
  const f = saturate(rh / below)
  return f * f
}

/**
 * Nutritional geometry: growth efficiency as a function of the protein fraction
 * of intake, peaking at the measured 2:1 protein:carbohydrate optimum.
 */
export function balanceFactor(proteinFraction: number): number {
  const d = (proteinFraction - BIO.optimum.proteinIntakeFraction) / BIO.tolerance.balanceWidth
  return Math.exp(-0.5 * d * d)
}

/** Softly saturating motility response to agar stiffness. */
export function motilityFactor(agarPercent: number): number {
  // ~1.5% w/v agar is the sweet spot: soft enough to advance, firm enough to grip.
  const d = (agarPercent - 1.5) / 1.6
  return clamp(1.05 * Math.exp(-0.5 * d * d) + 0.1, 0.1, 1.1)
}

export function pcRatioFromFraction(proteinFraction: number): number {
  const c = 1 - proteinFraction
  return c <= 1e-9 ? Infinity : proteinFraction / c
}
