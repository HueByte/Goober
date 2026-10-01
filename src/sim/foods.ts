/**
 * The larder.
 *
 * Every entry is a real food-composition table entry: grams per 100 g as served,
 * plus minerals and the two cofactors Physarum cannot make (thiamine, haematin),
 * plus pH, physical matrix and any toxins. Nothing about a food's behaviour in
 * the simulation is hand-tuned - it all falls out of these numbers through the
 * enzymology in biology.ts.
 *
 * Sources for the underlying numbers are ordinary food tables (USDA-style) for
 * the kitchen items, and the standard microbiological recipes for the lab items
 * (2% glucose agar, 10% peptone, yeast extract, Daniel and Baldwin's semi-defined
 * medium for Physarum).
 */

import {
  BIO,
  ENZYMES,
  MACRO_ELEMENTS,
  MACRO_YIELD,
  MATRIX,
  TRACE_MOLAR_MASS,
  enzymeFor,
  sugarMolarMass,
} from './biology'
import type {
  Composition,
  FoodDef,
  FoodInstance,
  MacroId,
  TraceId,
} from './types'

/** Order used by every composition read-out in the UI. */
export const MACRO_ORDER: MacroId[] = [
  'water',
  'sugars',
  'starch',
  'fiber',
  'protein',
  'freeAminoAcids',
  'lipid',
  'chitin',
  'nucleicAcids',
  'ash',
  'inert',
]

/** Nutritive macros, i.e. everything that can become substrate. */
export const NUTRITIVE_MACROS: MacroId[] = [
  'sugars',
  'starch',
  'fiber',
  'protein',
  'freeAminoAcids',
  'lipid',
  'chitin',
  'nucleicAcids',
]

const comp = (p: Partial<Composition>): Composition => ({
  water: 0,
  sugars: 0,
  starch: 0,
  fiber: 0,
  protein: 0,
  freeAminoAcids: 0,
  lipid: 0,
  chitin: 0,
  nucleicAcids: 0,
  ash: 0,
  inert: 0,
  ...p,
})

export const FOODS: FoodDef[] = [
  {
    id: 'oat-flake',
    name: 'Rolled oat flake',
    glyph: 'oat',
    category: 'classic',
    color: '#d8b872',
    blurb: 'The standard laboratory food. Starch-heavy, protein-poor.',
    comp: comp({
      water: 8.7,
      sugars: 1.0,
      starch: 57.8,
      fiber: 10.1,
      protein: 13.2,
      freeAminoAcids: 0.3,
      lipid: 6.5,
      nucleicAcids: 0.7,
      ash: 1.7,
    }),
    traces: { K: 429, P: 523, Mg: 177, Ca: 54, Fe: 4.7, Zn: 4.0, Na: 2, thiamine: 0.76 },
    ph: 6.2,
    sugarProfile: 'sucrose',
    matrix: 'flake',
    shape: 'flake',
    defaultMassMg: 250,
    radius: 2.4,
    volatiles: 60,
    toxins: [],
    notes: [
      'What Physarum is actually fed in almost every laboratory and classroom.',
      'Nearly all the carbon is alpha-glucan, so intake is amylase-gated: the flake must be colonised before it releases much.',
      'Carries thiamine but no haem iron - oats alone eventually stall on haematin.',
      '10% cellulose fibre is permanent residue; the flake never fully disappears.',
    ],
  },
  {
    id: 'glucose-agar',
    name: '2% glucose agar',
    glyph: 'glc',
    category: 'carbohydrate',
    color: '#7fd4a0',
    blurb: 'Pure energy, zero nitrogen. Absorbed with no enzyme at all.',
    comp: comp({ water: 96.3, sugars: 2.0, fiber: 1.5, protein: 0.05, ash: 0.15 }),
    traces: { K: 20, P: 3, Mg: 5, Ca: 12, Na: 30 },
    ph: 6.8,
    sugarProfile: 'glucose',
    matrix: 'gel',
    shape: 'gel',
    defaultMassMg: 400,
    radius: 3.0,
    toxins: [],
    notes: [
      'Free glucose crosses the membrane directly - no extracellular digestion needed.',
      'Gives a fast, wide chemoattractant plume because glucose is small and diffuses quickly.',
      'Carbon without nitrogen: the colony will be protein-limited within an hour of finding it.',
      'The 1.5% agarose is a galactan we cannot cleave - structural, not food.',
    ],
  },
  {
    id: 'peptone-drop',
    name: '6% peptone broth',
    glyph: 'pep',
    category: 'protein',
    color: '#c78bd8',
    blurb: 'Pre-hydrolysed casein: free amino acids, no protease needed.',
    comp: comp({ water: 93.3, freeAminoAcids: 5.4, protein: 0.4, nucleicAcids: 0.1, ash: 0.8 }),
    traces: { Na: 180, K: 40, P: 60, Ca: 15, Mg: 10, Fe: 0.9, Zn: 0.3, thiamine: 0.02 },
    ph: 7.1,
    sugarProfile: 'mixed',
    matrix: 'liquid',
    shape: 'drop',
    defaultMassMg: 300,
    radius: 2.6,
    toxins: [],
    notes: [
      'Acid-hydrolysed casein - the peptides are already small enough to absorb.',
      'Almost pure nitrogen: on peptone alone the colony runs out of carbon to burn.',
      'pH 7.1 is a full two units above the pH 5.2 optimum, which costs growth rate.',
      'Pair with glucose agar at roughly 2 parts peptone to 1 part glucose for the measured optimum.',
    ],
  },
  {
    id: 'yeast-extract',
    name: 'Yeast extract',
    glyph: 'YE',
    category: 'complex',
    color: '#c9a227',
    blurb: 'The everything food: peptides, nucleotides, B vitamins, minerals, some haem.',
    comp: comp({
      water: 5,
      sugars: 6,
      starch: 2,
      fiber: 2,
      protein: 24,
      freeAminoAcids: 32,
      lipid: 1,
      nucleicAcids: 10,
      ash: 18,
    }),
    traces: {
      K: 2700,
      P: 2000,
      Mg: 300,
      Ca: 100,
      Fe: 20,
      Zn: 8,
      Na: 3600,
      thiamine: 1.2,
      heme: 0.4,
    },
    ph: 6.5,
    sugarProfile: 'mixed',
    matrix: 'powder',
    shape: 'powder',
    defaultMassMg: 60,
    radius: 2.2,
    toxins: [],
    notes: [
      'Autolysed yeast: everything is already broken down, so uptake starts immediately.',
      '10% nucleic acid means both nitrogen bases and ribose - nitrogen and carbon from one pool.',
      'Cytochromes supply a little haem, which is why yeast extract rescues a haematin-starved culture.',
      '18% ash is a real osmotic load - a large deposit is locally hypertonic.',
    ],
  },
  {
    id: 'bacteria-lawn',
    name: 'Bacterial lawn',
    glyph: 'bac',
    category: 'classic',
    color: '#8fb8c9',
    blurb: 'Its natural diet. Whole cells, engulfed and lysed - and close to 2:1.',
    comp: comp({
      water: 75,
      sugars: 0.6,
      starch: 1.2,
      fiber: 0.6,
      protein: 14,
      freeAminoAcids: 0.7,
      lipid: 2.0,
      nucleicAcids: 4.0,
      ash: 1.9,
    }),
    traces: { K: 400, P: 700, Mg: 80, Ca: 10, Fe: 3, Zn: 2, Na: 120, thiamine: 0.3, heme: 0.25 },
    ph: 7.0,
    sugarProfile: 'mixed',
    matrix: 'cells',
    shape: 'lawn',
    defaultMassMg: 200,
    radius: 2.2,
    toxins: [],
    notes: [
      'In the wild the plasmodium phagocytoses bacteria whole, then digests them internally.',
      'Intact cells release slowly - the wall has to be breached first - but the balance is near ideal.',
      'Protein plus nucleic acid against sugar plus glycogen lands around 2:1, the measured optimum.',
      'Bacterial cytochromes supply haem, so a lawn is nutritionally complete on its own.',
    ],
  },
  {
    id: 'defined-medium',
    name: 'Semi-defined medium (2:1)',
    glyph: '2:1',
    category: 'defined',
    color: '#84e0d8',
    blurb: 'The reference broth: 2:1 protein:carbohydrate, pH 4.8, haematin + thiamine added.',
    comp: comp({
      water: 93.7,
      sugars: 1.85,
      protein: 0.6,
      freeAminoAcids: 3.2,
      lipid: 0.05,
      nucleicAcids: 0.1,
      ash: 0.5,
    }),
    traces: { K: 80, P: 40, Mg: 20, Ca: 15, Fe: 1.5, Zn: 0.5, Na: 50, thiamine: 0.5, heme: 0.3 },
    ph: 4.8,
    sugarProfile: 'glucose',
    matrix: 'liquid',
    shape: 'drop',
    defaultMassMg: 350,
    radius: 2.6,
    toxins: [],
    notes: [
      'Modelled on the classic axenic Physarum medium: tryptone plus glucose, buffered acidic.',
      'Haematin and thiamine are supplied deliberately, because the organism cannot make either.',
      'Intake ratio is 1.9:1 protein:carbohydrate - on the nose for maximum growth efficiency.',
      'On this medium nothing limits growth except temperature and how far it has to travel.',
    ],
  },
  {
    id: 'liver-puree',
    name: 'Liver puree',
    glyph: 'liv',
    category: 'complex',
    color: '#9c4b52',
    blurb: 'The haematin source. Iron-rich, protein-rich, glycogen for energy.',
    comp: comp({
      water: 68,
      sugars: 0.5,
      starch: 3.0,
      protein: 20,
      freeAminoAcids: 0.6,
      lipid: 4.0,
      nucleicAcids: 2.0,
      ash: 1.5,
      inert: 0.4,
    }),
    traces: { K: 313, P: 387, Mg: 21, Ca: 10, Fe: 18, Zn: 4, Na: 80, thiamine: 0.3, heme: 12 },
    ph: 6.4,
    sugarProfile: 'mixed',
    matrix: 'solid',
    shape: 'chunk',
    defaultMassMg: 300,
    radius: 2.4,
    toxins: [],
    notes: [
      'Historically where the haematin in Physarum media came from.',
      'A single deposit clears a haem deficiency for a long time - it is 12 mg haem per 100 g.',
      'Glycogen is an alpha-glucan, so amylase handles the carbohydrate side.',
      'Intact tissue: enzyme access is poor until the plasmodium has spread over it.',
    ],
  },
  {
    id: 'egg-yolk',
    name: 'Egg yolk',
    glyph: 'yolk',
    category: 'complex',
    color: '#e8b33c',
    blurb: 'Lipid-dominated. Enormous calories, released at the speed of a weak lipase.',
    comp: comp({
      water: 54.4,
      sugars: 0.6,
      protein: 15.5,
      freeAminoAcids: 0.4,
      lipid: 26.5,
      nucleicAcids: 0.9,
      ash: 1.7,
    }),
    traces: { K: 109, P: 390, Mg: 5, Ca: 129, Fe: 2.7, Zn: 3.1, Na: 48, thiamine: 0.17, heme: 0.02 },
    ph: 6.3,
    sugarProfile: 'glucose',
    matrix: 'liquid',
    shape: 'drop',
    defaultMassMg: 300,
    radius: 2.4,
    toxins: [],
    notes: [
      'On paper the most energy-dense thing on the menu: 9 kcal per gram of fat.',
      'In practice lipase capability is only 0.45, so that energy trickles in.',
      'Triglyceride carries no nitrogen, so the protein fraction still sets the growth rate.',
      'Phospholipid and cholesterol are useful membrane precursors the colony would otherwise build itself.',
    ],
  },
  {
    id: 'banana',
    name: 'Banana slice',
    glyph: 'ban',
    category: 'carbohydrate',
    color: '#e3d15c',
    blurb: 'pH 5.0, right on the optimum - and almost no nitrogen whatsoever.',
    comp: comp({
      water: 77.3,
      sugars: 12.2,
      starch: 5.4,
      fiber: 2.6,
      protein: 1.1,
      freeAminoAcids: 0.2,
      lipid: 0.3,
      nucleicAcids: 0.1,
      ash: 0.8,
    }),
    traces: { K: 358, P: 22, Mg: 27, Ca: 5, Fe: 0.26, Zn: 0.15, Na: 1, thiamine: 0.031 },
    ph: 5.0,
    sugarProfile: 'mixed',
    matrix: 'solid',
    shape: 'slice',
    defaultMassMg: 400,
    radius: 2.8,
    toxins: [],
    notes: [
      'Its pH 5.0 is almost exactly the organism optimum, so uptake here is efficient.',
      'Intake ratio is about 0.1:1 protein:carbohydrate - twenty times too carbon-rich.',
      'Excellent potassium, which the colony needs at 2.5% of dry mass.',
      'Ripening converts starch to sugar, which is why both pools are listed.',
    ],
  },
  {
    id: 'honey-drop',
    name: 'Honey drop',
    glyph: 'hny',
    category: 'carbohydrate',
    color: '#d99b2b',
    blurb: 'Calorie-dense, acidic, and so concentrated it pulls water out of the cell.',
    comp: comp({ water: 17.1, sugars: 82.4, freeAminoAcids: 0.3, ash: 0.2 }),
    traces: { K: 52, Ca: 6, P: 4, Mg: 2, Na: 4, Fe: 0.4 },
    ph: 3.9,
    sugarProfile: 'mixed',
    matrix: 'liquid',
    shape: 'drop',
    defaultMassMg: 250,
    radius: 2.2,
    toxins: [],
    notes: [
      'Undiluted it is hypertonic far past anything the model bothers to scale - an osmotic weapon, not a meal.',
      'pH 3.9 is below the tolerated band; growth on undiluted honey is close to zero.',
      'Becomes genuinely excellent food once the agar has diluted it - watch the plume, not the drop.',
      'This is exactly why honey does not spoil: low water activity, not low calories.',
    ],
  },
  {
    id: 'milk-drop',
    name: 'Milk drop',
    glyph: 'milk',
    category: 'carbohydrate',
    color: '#f0ece0',
    blurb: 'Its sugar is lactose - and beta-galactosidase is the one enzyme we lack.',
    comp: comp({
      water: 87.5,
      sugars: 4.8,
      protein: 3.3,
      freeAminoAcids: 0.1,
      lipid: 3.6,
      nucleicAcids: 0.02,
      ash: 0.7,
    }),
    traces: { Ca: 113, P: 93, K: 143, Mg: 10, Na: 43, Zn: 0.4, Fe: 0.03, thiamine: 0.045 },
    ph: 6.7,
    sugarProfile: 'lactose',
    matrix: 'liquid',
    shape: 'drop',
    defaultMassMg: 300,
    radius: 2.5,
    toxins: [],
    notes: [
      'The trap on the menu. 4.8 g of sugar per 100 g, and 96% of it is unavailable.',
      'Beta-galactosidase capability is 0.04, so lactose is effectively inert ballast.',
      'What is left is casein (protease-gated) and butterfat (lipase-gated): slow but real food.',
      'Superb calcium, which is a genuine requirement at 0.15% of dry mass.',
    ],
  },
  {
    id: 'sucrose-crystal',
    name: 'Sucrose crystal',
    glyph: 'suc',
    category: 'carbohydrate',
    color: '#f2f2f7',
    blurb: 'Anhydrous disaccharide. Must be dissolved, then cleaved by invertase.',
    comp: comp({ water: 0.2, sugars: 99.6, ash: 0.2 }),
    traces: {},
    ph: 6.5,
    sugarProfile: 'sucrose',
    matrix: 'crystal',
    shape: 'crystal',
    defaultMassMg: 120,
    radius: 1.4,
    toxins: [],
    notes: [
      'Anhydrous: locally it is effectively a saturated solution, and violently hypertonic.',
      'Sucrose is a disaccharide - invertase has to split it before either half can be absorbed.',
      'Once diluted it is clean carbon, which makes it a good partner for peptone.',
      'Pure carbon with zero nitrogen, zero minerals and zero cofactors.',
    ],
  },
  {
    id: 'potato-starch',
    name: 'Potato starch',
    glyph: 'sta',
    category: 'carbohydrate',
    color: '#e6e6ea',
    blurb: 'A timed-release carbon depot: amylase has to work through the granules.',
    comp: comp({ water: 12, sugars: 0.6, starch: 85, fiber: 1.5, protein: 0.4, ash: 0.5 }),
    traces: { K: 35, P: 80, Mg: 6, Ca: 8 },
    ph: 6.4,
    sugarProfile: 'maltose',
    matrix: 'powder',
    shape: 'powder',
    defaultMassMg: 200,
    radius: 2.2,
    toxins: [],
    notes: [
      'Non-osmotic: polymerised glucose exerts almost no osmotic pressure, unlike the same mass of sugar.',
      'Release is proportional to colonisation, so it feeds the colony for hours rather than minutes.',
      'This is why starch, not glucose, is the classic long-run carbon source.',
      'Nitrogen-free, so it never fixes a protein limitation.',
    ],
  },
  {
    id: 'dead-fly',
    name: 'Dead fly',
    glyph: 'fly',
    category: 'complex',
    color: '#6c6f7a',
    blurb: 'Well-balanced meat inside indigestible armour. Chitinase is weak.',
    comp: comp({
      water: 65,
      sugars: 0.3,
      starch: 0,
      fiber: 0.2,
      protein: 16.5,
      freeAminoAcids: 0.8,
      lipid: 8.0,
      chitin: 4.5,
      nucleicAcids: 1.2,
      ash: 2.0,
      inert: 1.5,
    }),
    traces: { K: 320, P: 480, Mg: 60, Ca: 70, Fe: 4, Zn: 3, Na: 120, thiamine: 0.2, heme: 0.3 },
    ph: 6.6,
    sugarProfile: 'mixed',
    matrix: 'solid',
    shape: 'chunk',
    defaultMassMg: 350,
    radius: 2.4,
    toxins: [],
    notes: [
      'Nutritionally close to ideal, and physically the hardest thing here to get into.',
      'Chitin is an amino sugar: the 12% we can cleave yields both carbon and nitrogen.',
      'The other 88% of the cuticle stays on the plate forever as residue.',
      'Haemolymph and mitochondria supply haem, so a fly is a complete meal.',
    ],
  },
  {
    id: 'cellulose-pad',
    name: 'Cellulose pad',
    glyph: 'cel',
    category: 'antagonist',
    color: '#cfc9b8',
    blurb: '92% cellulose. Calorie-dense on paper, completely inedible in practice.',
    comp: comp({ water: 6, fiber: 92, ash: 2 }),
    traces: { Ca: 12, K: 8 },
    ph: 6.9,
    sugarProfile: 'glucose',
    matrix: 'solid',
    shape: 'lawn',
    defaultMassMg: 300,
    radius: 2.6,
    toxins: [],
    notes: [
      'Chemically this is glucose, polymerised with beta-1,4 bonds instead of alpha-1,4.',
      'That single bond difference is the whole story: cellulase capability is 0.0.',
      'A gross-energy table would score this at 380 kcal per 100 g. Digestible energy is zero.',
      'Useful as a physical obstacle, or to prove that composition alone does not make food.',
    ],
  },
  {
    id: 'salt-crystal',
    name: 'Salt crystal',
    glyph: 'NaCl',
    category: 'antagonist',
    color: '#dfe7f2',
    blurb: 'No calories, saturated brine. A pure osmotic repellent.',
    comp: comp({ water: 0.1, ash: 99.9 }),
    traces: { Na: 39300, K: 20 },
    ph: 7.0,
    sugarProfile: 'glucose',
    matrix: 'crystal',
    shape: 'crystal',
    defaultMassMg: 60,
    radius: 1.2,
    toxins: [
      {
        name: 'sodium ion',
        mgPer100g: 39300,
        potency: 0.0008,
        repellency: 0.35,
        note: 'Sodium is not just osmotically active, it is ionically disruptive at high load.',
      },
    ],
    notes: [
      'Sodium chloride dissociates into two osmotically active particles per formula unit.',
      'Water leaves the plasmodium faster than it can be replaced: motility collapses first, then biomass.',
      'The standard way to draw a boundary the colony refuses to cross.',
      'Trace sodium is in fact required, at 0.06% of dry mass. A crystal is roughly 60000 times that dose.',
    ],
  },
  {
    id: 'quinine',
    name: 'Quinine crystal',
    glyph: 'qui',
    category: 'antagonist',
    color: '#b8c98f',
    blurb: 'The classic chemorepellent of the Physarum literature. Bitter and cytotoxic.',
    comp: comp({ water: 5, ash: 3, inert: 92 }),
    traces: {},
    ph: 6.0,
    sugarProfile: 'glucose',
    matrix: 'crystal',
    shape: 'crystal',
    defaultMassMg: 80,
    radius: 1.6,
    toxins: [
      {
        name: 'quinine',
        mgPer100g: 92000,
        potency: 0.012,
        repellency: 1.0,
        narcosis: 0.3,
        note: 'Alkaloid; blocks ion channels and disrupts the contraction rhythm.',
      },
    ],
    notes: [
      'Quinine bridges are how the habituation and maze-solving experiments were staged.',
      'Strong active avoidance: the plasmodium steers away before it takes damage.',
      'A hungry colony will eventually cross a quinine gap to reach food on the far side.',
      'Non-nutritive: the mass shown is alkaloid, not substrate.',
    ],
  },
  {
    id: 'coffee-drop',
    name: 'Coffee drop',
    glyph: 'caf',
    category: 'antagonist',
    color: '#6b4a32',
    blurb: 'Caffeine perturbs the calcium oscillator that drives shuttle streaming.',
    comp: comp({ water: 98.0, sugars: 0.3, freeAminoAcids: 0.2, ash: 0.4, inert: 1.1 }),
    traces: { K: 49, Mg: 3, P: 3, Na: 2 },
    ph: 5.0,
    sugarProfile: 'mixed',
    matrix: 'liquid',
    shape: 'drop',
    defaultMassMg: 250,
    radius: 2.2,
    toxins: [
      {
        name: 'caffeine',
        mgPer100g: 40,
        potency: 0.05,
        repellency: 0.3,
        narcosis: 0.75,
        note: 'Interferes with calcium handling, and so with the contraction rhythm that moves cytoplasm.',
      },
    ],
    notes: [
      'Brewed coffee is about 40 mg of caffeine per 100 ml - a mild dose, and a real one.',
      'Physarum moves by rhythmic contraction on a roughly 100-second calcium cycle; caffeine detunes it.',
      'Nutritionally almost water, so this is a behavioural perturbation rather than a food.',
      'pH 5.0 is in the comfortable band, which is why the effect reads as caffeine rather than acid.',
    ],
  },
  {
    id: 'fish-flake',
    name: 'Tropical fish flake',
    glyph: 'fish',
    category: 'classic',
    color: '#c8703f',
    blurb: 'Fish meal, cereal binder and a full vitamin premix. Nearly a complete diet.',
    comp: comp({
      water: 7.0,
      sugars: 2.0,
      starch: 20.0,
      fiber: 2.0,
      protein: 47.0,
      freeAminoAcids: 1.5,
      lipid: 7.5,
      chitin: 1.5,
      nucleicAcids: 1.5,
      ash: 10.0,
    }),
    traces: {
      K: 900,
      P: 1400,
      Mg: 180,
      Ca: 2300,
      Fe: 25,
      Zn: 12,
      Na: 600,
      thiamine: 2.5,
      heme: 1.2,
    },
    ph: 6.3,
    sugarProfile: 'mixed',
    matrix: 'flake',
    shape: 'flake',
    defaultMassMg: 120,
    radius: 2.0,
    volatiles: 180,
    toxins: [],
    notes: [
      'The other food hobbyists actually keep Physarum on, and the only one on this menu that supplies everything at once.',
      'Fish meal carries haem iron and the vitamin premix carries thiamine, so neither cofactor runs the colony into a wall.',
      'Protein-biased rather than at the 2:1 optimum: what limits growth here is carbon, not nitrogen.',
      'The shrimp-meal fraction brings chitin, which is residue - a flake never quite finishes.',
    ],
  },
  {
    id: 'egg-white',
    name: 'Boiled egg white',
    glyph: 'alb',
    category: 'protein',
    color: '#f2efe6',
    blurb: 'Nitrogen with no carbon behind it, at pH 9. Liebig in one deposit.',
    comp: comp({ water: 87.6, sugars: 0.7, protein: 10.9, lipid: 0.2, ash: 0.6 }),
    traces: { K: 163, Na: 166, P: 15, Mg: 11, Ca: 7, thiamine: 0.004 },
    ph: 9.0,
    sugarProfile: 'glucose',
    matrix: 'solid',
    shape: 'chunk',
    defaultMassMg: 320,
    radius: 2.4,
    toxins: [],
    notes: [
      'Ovalbumin is an excellent protease substrate, so the nitrogen comes out readily.',
      'There is essentially no carbohydrate, so every gram of new structure has to be built by burning amino acids - at 55% efficiency, with the carbon skeletons largely wasted.',
      'Cooked white sits at pH 9.0, well outside the comfortable band, so growth is slow even where the food itself is good.',
      'Place it beside a sugar source and the colony will shuttle between the two rather than settle on either.',
    ],
  },
  {
    id: 'mushroom-cap',
    name: 'Mushroom cap',
    glyph: 'fun',
    category: 'complex',
    color: '#d6cbb4',
    blurb: 'Another decomposer, built out of chitin. Mostly unopenable.',
    comp: comp({
      water: 92.4,
      sugars: 0.5,
      fiber: 1.0,
      protein: 3.1,
      freeAminoAcids: 0.4,
      lipid: 0.3,
      chitin: 0.8,
      nucleicAcids: 0.6,
      ash: 0.9,
    }),
    traces: { K: 318, P: 86, Mg: 9, Ca: 3, Fe: 0.5, Zn: 0.5, Na: 5, thiamine: 0.081 },
    ph: 6.2,
    sugarProfile: 'mixed',
    matrix: 'solid',
    shape: 'chunk',
    defaultMassMg: 420,
    radius: 2.8,
    volatiles: 240,
    toxins: [],
    notes: [
      'A fungal cell wall is chitin and beta-glucan, and chitinase capability is 0.12 - enough to work on it, nowhere near enough to live on it.',
      'What is actually taken is the cytoplasm inside: the free amino acids, the nucleic acids and the little soluble sugar.',
      'Over 90% water, so the deposit shrinks quickly and yields very little for its size.',
      'A good demonstration that two decomposers on the same log are not eating the same thing.',
    ],
  },
  {
    id: 'lentil-flour',
    name: 'Lentil flour',
    glyph: 'len',
    category: 'protein',
    color: '#b0824f',
    blurb: 'Plant protein and starch together, in a powder that wets immediately.',
    comp: comp({
      water: 10.4,
      sugars: 2.0,
      starch: 48.0,
      fiber: 10.7,
      protein: 24.6,
      freeAminoAcids: 0.5,
      lipid: 1.1,
      ash: 2.7,
    }),
    traces: { K: 955, P: 281, Mg: 47, Ca: 35, Fe: 6.5, Zn: 3.3, Na: 6, thiamine: 0.87 },
    ph: 6.5,
    sugarProfile: 'mixed',
    matrix: 'powder',
    shape: 'powder',
    defaultMassMg: 200,
    radius: 2.2,
    toxins: [],
    notes: [
      'What an oat flake is missing: twice the protein, and the starch to burn alongside it.',
      'Ground, so the matrix barrier an oat flake puts up is already gone and release starts at once.',
      'No haematin at all, so a colony kept on this alone still stalls eventually.',
      'The 10.7% fibre is cellulose and pectin, and stays on the plate as residue.',
    ],
  },
  {
    id: 'malt-extract',
    name: 'Malt extract',
    glyph: 'mlt',
    category: 'carbohydrate',
    color: '#8a5a21',
    blurb: 'Maltose syrup. Amylase opens it instantly; the osmolarity is the catch.',
    comp: comp({
      water: 20.0,
      sugars: 72.0,
      protein: 4.6,
      freeAminoAcids: 0.6,
      ash: 1.8,
      inert: 1.0,
    }),
    traces: { K: 600, P: 180, Mg: 60, Ca: 50, Fe: 1.5, Zn: 0.6, Na: 70, thiamine: 0.1 },
    ph: 5.2,
    sugarProfile: 'maltose',
    matrix: 'liquid',
    shape: 'drop',
    defaultMassMg: 220,
    radius: 2.2,
    volatiles: 420,
    toxins: [],
    notes: [
      'Maltose is two glucoses in an alpha-1,4 bond - the same bond as starch, and amylase capability is 0.95.',
      'The classic mycological medium: malt extract agar is what most fungi are grown on.',
      'Only a fifth of the mass is water, so the syrup is near saturation and pulls water out of whatever touches it.',
      'pH 5.2 is almost exactly where Physarum wants to be, which is the rest of why it works so well.',
    ],
  },
  {
    id: 'blank-agar',
    name: 'Plain 1.5% agar',
    glyph: 'nil',
    category: 'stimulus',
    color: '#aebdc4',
    blurb: 'The control. Something is there; none of it is food.',
    comp: comp({ water: 98.4, fiber: 1.5, ash: 0.1 }),
    traces: { Ca: 10, K: 5, Na: 15, Mg: 2 },
    ph: 7.0,
    sugarProfile: 'glucose',
    matrix: 'gel',
    shape: 'gel',
    defaultMassMg: 400,
    radius: 2.6,
    toxins: [],
    notes: [
      'Agarose is a galactan, with beta-1,4 and alpha-1,3 bonds. No enzyme here touches either.',
      'Place it opposite a real deposit and the colony will ignore it entirely, which is the point of it.',
      'This is what any apparent response should be checked against: it is what "no stimulus" looks like.',
      'Very nearly all water, so it will shrink away and vanish without ever having fed anything.',
    ],
  },
  {
    id: 'valerian-drop',
    name: 'Valerian tincture',
    glyph: 'val',
    category: 'stimulus',
    color: '#9aa86b',
    blurb: 'Smells like a meal from across the vessel. Is not a meal.',
    comp: comp({ water: 92.0, sugars: 1.2, freeAminoAcids: 0.3, ash: 0.6, inert: 5.9 }),
    traces: { K: 60, Mg: 5, Ca: 8 },
    ph: 5.3,
    sugarProfile: 'mixed',
    matrix: 'liquid',
    shape: 'drop',
    defaultMassMg: 150,
    radius: 2.0,
    volatiles: 2600,
    toxins: [],
    notes: [
      'Valerian root is loaded with isovaleric and valerenic acid, both volatile and both powerfully attractive to Physarum.',
      'The attraction is to the vapour, which carries far beyond anything the drop has put into solution.',
      'Nutritionally it is about a thousandth of an oat flake. The colony arrives, finds nothing, and has to decide what to do about it.',
      'Put one across the plate from a real deposit to watch what happens when the organism\'s nose and its stomach disagree.',
    ],
  },
  {
    id: 'copper-sulfate',
    name: 'Copper sulfate crystal',
    glyph: 'CuSO4',
    category: 'antagonist',
    color: '#4f9fd6',
    blurb: 'Only mildly repellent, thoroughly lethal. It gets walked into.',
    comp: comp({ water: 36.0, ash: 64.0 }),
    traces: { Na: 1 },
    ph: 4.0,
    sugarProfile: 'glucose',
    matrix: 'crystal',
    shape: 'crystal',
    defaultMassMg: 50,
    radius: 1.2,
    toxins: [
      {
        name: 'copper(II)',
        mgPer100g: 25400,
        potency: 0.02,
        repellency: 0.55,
        note: 'Binds thiol groups indiscriminately, so enzymes stop working rather than slow down.',
      },
    ],
    notes: [
      'The pentahydrate is 36% water of crystallisation, which is why it dissolves into the agar so readily.',
      'Quinine is avoided at four times the distance at which it does harm. Copper is not: the warning and the damage arrive together.',
      'Strongly acidifying as well - the solution sits near pH 4, below the tolerated band on its own.',
      'The usual way to kill off one arm of a network and watch the rest re-route around it.',
    ],
  },
  {
    id: 'vinegar-drop',
    name: 'Vinegar drop',
    glyph: 'HAc',
    category: 'antagonist',
    color: '#d9cf9a',
    blurb: 'pH 2.4. Nothing in it is especially poisonous; the acid alone is enough.',
    comp: comp({ water: 94.8, sugars: 0.1, ash: 0.2, inert: 4.9 }),
    traces: { K: 73, Na: 5, Mg: 1, Ca: 7 },
    ph: 2.4,
    sugarProfile: 'glucose',
    matrix: 'liquid',
    shape: 'drop',
    defaultMassMg: 250,
    radius: 2.2,
    volatiles: 900,
    toxins: [
      {
        name: 'acetic acid',
        mgPer100g: 5000,
        potency: 0.004,
        repellency: 0.45,
        note: 'Undissociated acetic acid crosses the membrane freely and acidifies the cytoplasm from the inside.',
      },
    ],
    notes: [
      'Physarum works between roughly pH 4.5 and 7. Two units below that, nothing functions at all.',
      'The harm is almost entirely the proton gradient: by mass the acid is barely cytotoxic.',
      'Acetic acid is volatile, so the plume reaches further than the drop - and then fades as it evaporates.',
      'A barrier with a shelf life. Leave it long enough and the colony walks over where it used to be.',
    ],
  },
  {
    id: 'glycerol-drop',
    name: 'Glycerol drop',
    glyph: 'gly',
    category: 'antagonist',
    color: '#cfd8e6',
    blurb: 'Harmless, inedible and desiccating. Induces encystment rather than death.',
    comp: comp({ water: 30.0, ash: 0.2, inert: 69.8 }),
    inertMolarMass: 92,
    traces: { Na: 2 },
    ph: 6.5,
    sugarProfile: 'glucose',
    matrix: 'liquid',
    shape: 'drop',
    defaultMassMg: 250,
    radius: 2.2,
    toxins: [],
    notes: [
      'Not toxic, not acidic, not bitter, and not food either. The only thing glycerol does here is hold on to water.',
      'A non-electrolyte, so unlike salt it contributes one osmotic particle per molecule rather than two - and there are a very great many molecules.',
      'The response is the real one to drying: the plasmodium withdraws, thickens and encysts as a sclerotium rather than dying.',
      'The difference from a salt crystal is that this is recoverable. Wet the area again and the dormant mass wakes up.',
    ],
  },
  {
    id: 'garlic-paste',
    name: 'Garlic paste',
    glyph: 'all',
    category: 'antagonist',
    color: '#e3dcc0',
    blurb: 'Nutritious on paper. Allicin stops the streaming before any of it is eaten.',
    comp: comp({
      water: 58.6,
      sugars: 1.0,
      fiber: 30.3,
      protein: 6.4,
      freeAminoAcids: 0.6,
      lipid: 0.5,
      ash: 1.5,
      inert: 1.1,
    }),
    traces: { K: 401, P: 153, Mg: 25, Ca: 181, Fe: 1.7, Zn: 1.2, Na: 17, thiamine: 0.2 },
    ph: 5.8,
    sugarProfile: 'mixed',
    matrix: 'powder',
    shape: 'powder',
    defaultMassMg: 200,
    radius: 2.2,
    volatiles: 700,
    toxins: [
      {
        name: 'allicin',
        mgPer100g: 400,
        potency: 0.03,
        repellency: 0.5,
        narcosis: 0.5,
        note: 'A thiosulfinate: reacts with thiols, and detunes the calcium handling that drives contraction.',
      },
    ],
    notes: [
      'Garlic carbohydrate is almost all inulin, a fructan with beta-2,1 bonds, and there is no inulinase here - so it reads as fibre.',
      'Which means 30% of the deposit is residue, and what is left is a modest protein source wrapped around a defence compound.',
      'Allicin only forms when the clove is crushed. A whole one is inert; a paste is not.',
      'The visible effect is the streaming slowing to a crawl near the deposit rather than the colony dying on it.',
    ],
  },
]

export const FOOD_BY_ID: Record<string, FoodDef> = Object.fromEntries(
  FOODS.map((f) => [f.id, f]),
)

// ---------------------------------------------------------------------------
// Derived nutritional analysis
// ---------------------------------------------------------------------------

export interface MacroBreakdown {
  macro: MacroId
  label: string
  grams: number
  enzyme: string | null
  capability: number
  /** Grams that can actually be mobilised, after enzymology and matrix access. */
  usableGrams: number
  carbEqGrams: number
  proteinEqGrams: number
}

export interface FoodAnalysis {
  dryMatter: number
  grossKcal: number
  digestibleKcal: number
  proteinEq: number
  carbEq: number
  /** Protein : carbohydrate ratio of the digestible fraction. */
  pcRatio: number
  proteinFraction: number
  /** Elemental carbon : nitrogen mass ratio. */
  cnRatio: number
  osmolarity: number
  anhydrous: boolean
  residue: number
  breakdown: MacroBreakdown[]
  toxinLoad: number
  /** Summed suppression of the streaming rhythm, 0..1-ish. */
  narcoticLoad: number
  /** Volatile attractant, mg per 100 g. */
  volatiles: number
  tags: string[]
  cofactors: { thiamine: number; heme: number }
}

const analysisCache = new Map<string, FoodAnalysis>()

/**
 * Osmotically active solute in the food, in mmol per 100 g. This is the number
 * that matters once a deposit has dissolved into the surrounding agar.
 */
export function osmolesPer100g(def: FoodDef): number {
  return osmolarityOf(def).mmol
}

/**
 * One voxel of the vessel is one cubic millimetre, i.e. one microlitre, so a
 * deposit's solute disperses into a measurable volume of agar. This is the
 * concentration the plasmodium actually experiences next to the deposit.
 */
export function dispersedOsmolarity(def: FoodDef, massMg: number): number {
  const mmol = (osmolesPer100g(def) * massMg) / 100_000
  const reach = def.radius * 2.5
  const litres = ((4 / 3) * Math.PI * reach ** 3) / 1e6
  return Math.min(8000, mmol / litres)
}

/** Osmolarity of the food's own water phase, in mOsm/L. */
export function osmolarityOf(def: FoodDef): { value: number; anhydrous: boolean; mmol: number } {
  const c = def.comp
  // mmol of osmotically active particles per 100 g.
  let mmol = 0
  mmol += (c.sugars / sugarMolarMass(def.sugarProfile)) * 1000
  // Peptone and yeast extract are peptide mixtures, not free amino acids.
  mmol += (c.freeAminoAcids / 300) * 1000
  // Polymers are one particle per chain: osmotically negligible.
  mmol += (c.starch / 50000) * 1000
  mmol += (c.protein / 25000) * 1000
  // A dissolved non-electrolyte in the inert fraction - glycerol, say - carries
  // no charge, yields no energy and cannot be digested, and is still one
  // osmotically active particle per molecule. That is the whole of its effect.
  if (def.inertMolarMass && c.inert > 0) {
    mmol += (c.inert / def.inertMolarMass) * 1000
  }
  // Salts dissociate. Count each listed cation plus its counter-ion. Phosphorus
  // is skipped because phosphate is generally that counter-ion already.
  for (const [id, mg] of Object.entries(def.traces) as [TraceId, number][]) {
    if (id === 'P') continue
    const mm = TRACE_MOLAR_MASS[id]
    if (!mm || !mg) continue
    mmol += (mg / mm) * (id === 'Mg' || id === 'Ca' ? 3 : 2)
  }
  // Any ash not accounted for by the listed cations, as a generic 1:1 salt.
  const listedAshG =
    (Object.entries(def.traces) as [TraceId, number][]).reduce(
      (s, [id, mg]) => (TRACE_MOLAR_MASS[id] ? s + (mg ?? 0) / 1000 : s),
      0,
    ) * 2.5
  const unlistedAsh = Math.max(0, c.ash - listedAshG)
  mmol += (unlistedAsh / 80) * 1000 * 1.8

  const anhydrous = c.water < 5
  // Litres of water per 100 g, assuming unit density. Dry foods dissolve into
  // whatever moisture the agar provides, so floor the water phase.
  const waterL = Math.max(c.water, 3) / 1000
  const value = Math.min(mmol / waterL, 8000)
  return { value, anhydrous, mmol }
}

export function analyse(def: FoodDef): FoodAnalysis {
  const cached = analysisCache.get(def.id)
  if (cached) return cached

  const breakdown: MacroBreakdown[] = []
  let grossKcal = 0
  let digestibleKcal = 0
  let proteinEq = 0
  let carbEq = 0
  let carbon = 0
  let nitrogen = 0
  let residue = 0
  const access = MATRIX[def.matrix].access

  for (const macro of MACRO_ORDER) {
    const grams = def.comp[macro]
    if (macro === 'water') continue
    const el = MACRO_ELEMENTS[macro]
    grossKcal += grams * el.kcalPerG
    carbon += grams * el.C
    nitrogen += grams * el.N

    const enzId = enzymeFor(macro, def.sugarProfile)
    const capability = enzId ? ENZYMES[enzId].capability : 1
    // Matrix access slows release down but does not make food inedible, so it
    // is not part of the usable fraction - only enzymology is.
    const usableGrams = grams * capability
    residue += grams - usableGrams
    const y = MACRO_YIELD[macro]
    const carbEqGrams = usableGrams * y.carbEq
    const proteinEqGrams = usableGrams * y.proteinEq
    carbEq += carbEqGrams
    proteinEq += proteinEqGrams
    digestibleKcal += usableGrams * el.kcalPerG

    if (grams > 0 || macro === 'ash') {
      breakdown.push({
        macro,
        label: MACRO_YIELD[macro].label,
        grams,
        enzyme: enzId ? ENZYMES[enzId].label : null,
        capability,
        usableGrams,
        carbEqGrams,
        proteinEqGrams,
      })
    }
  }

  const total = proteinEq + carbEq
  const proteinFraction = total > 1e-9 ? proteinEq / total : 0
  const pcRatio = carbEq > 1e-9 ? proteinEq / carbEq : proteinEq > 0 ? Infinity : 0
  const cnRatio = nitrogen > 1e-9 ? carbon / nitrogen : Infinity
  const { value: osmolarity, anhydrous } = osmolarityOf(def)
  const toxinLoad = def.toxins.reduce((s, t) => s + (t.mgPer100g / 1000) * t.potency, 0)
  const narcoticLoad = def.toxins.reduce((s, t) => s + (t.narcosis ?? 0), 0)
  const volatiles = def.volatiles ?? 0

  const tags: string[] = []
  if (total < 0.5) tags.push('non-nutritive')
  else if (pcRatio === Infinity || pcRatio > 6) tags.push('nitrogen source only')
  else if (pcRatio > 1.2) tags.push('protein-biased')
  else if (pcRatio < 0.25) tags.push('carbon-biased')
  else if (Math.abs(pcRatio - 2) < 0.8) tags.push('near 2:1 optimum')
  else tags.push('carbon-leaning')

  if (osmolarity > 1200) tags.push('hyperosmotic')
  if (def.ph < 4.3) tags.push('too acidic')
  else if (def.ph > 6.8) tags.push('alkaline for us')
  else if (Math.abs(def.ph - BIO.optimum.ph) < 0.6) tags.push('pH optimal')
  if (toxinLoad > 0.05) tags.push('cytotoxic')
  if ((def.traces.heme ?? 0) > 0.1) tags.push('supplies haematin')
  if ((def.traces.thiamine ?? 0) > 0.2) tags.push('supplies thiamine')
  if (residue > 8) tags.push('leaves residue')
  if (access < 0.5) tags.push('slow release')
  if (narcoticLoad > 0.2) tags.push('suppresses streaming')
  if (volatiles > 300) tags.push('strongly odorous')
  if (volatiles > 300 && total < 1.5) tags.push('lure')

  const result: FoodAnalysis = {
    dryMatter: 100 - def.comp.water,
    grossKcal,
    digestibleKcal,
    proteinEq,
    carbEq,
    pcRatio,
    proteinFraction,
    cnRatio,
    osmolarity,
    anhydrous,
    residue,
    breakdown,
    toxinLoad,
    narcoticLoad,
    volatiles,
    tags,
    cofactors: { thiamine: def.traces.thiamine ?? 0, heme: def.traces.heme ?? 0 },
  }
  analysisCache.set(def.id, result)
  return result
}

let instanceSeq = 0

export function createFoodInstance(
  def: FoodDef,
  x: number,
  y: number,
  z: number,
  massMg: number,
  nowMin: number,
): FoodInstance {
  const pools = {} as Record<MacroId, number>
  for (const macro of MACRO_ORDER) {
    pools[macro] = (def.comp[macro] / 100) * massMg
  }
  const traces: Partial<Record<TraceId, number>> = {}
  for (const [id, mgPer100g] of Object.entries(def.traces) as [TraceId, number][]) {
    // mg/100 g -> micrograms in this deposit.
    traces[id] = (mgPer100g * massMg) / 100
  }
  return {
    id: `f${++instanceSeq}`,
    defId: def.id,
    x,
    y,
    z,
    pools,
    traces,
    initialMassMg: massMg,
    colonization: 0,
    assimilatedMg: 0,
    residueMg: 0,
    createdAtMin: nowMin,
  }
}

export function foodMassMg(f: FoodInstance): number {
  let m = 0
  for (const macro of MACRO_ORDER) m += f.pools[macro]
  return m
}

/** Mass still locked in pools we have no enzyme for. */
export function foodResidueMg(f: FoodInstance): number {
  const def = FOOD_BY_ID[f.defId]
  let m = f.pools.inert
  for (const macro of NUTRITIVE_MACROS) {
    const enz = enzymeFor(macro, def.sugarProfile)
    if (enz && ENZYMES[enz].capability < 0.1) m += f.pools[macro]
  }
  return m
}

/**
 * Liebig's barrel for a single deposit: how much plasmodium this much of this
 * food could actually build, and which component runs out first.
 */
export interface YieldPotential {
  biomassMg: number
  limitedBy: string
  byProtein: number
  byCarb: number
  byTrace: { id: TraceId; supportsMg: number; suppliedUg: number }[]
}

export function yieldPotential(def: FoodDef, massMg: number): YieldPotential {
  const a = analyse(def)
  const scale = massMg / 100 / 1000 // grams per 100 g -> grams in this deposit
  const proteinG = a.proteinEq * scale
  const carbG = a.carbEq * scale
  // grams of substrate -> milligrams of biomass
  const byProtein = (proteinG / BIO.biomass.proteinEqPerUg) * 1000
  const byCarb =
    (carbG / (BIO.biomass.carbEqPerUg + BIO.biomass.anabolicOverhead)) * 1000

  const byTrace = (Object.keys(BIO.biomass.traceFraction) as TraceId[]).map((id) => {
    const suppliedUg = ((def.traces[id] ?? 0) * massMg) / 100
    const frac = BIO.biomass.traceFraction[id]
    return { id, suppliedUg, supportsMg: frac > 0 ? suppliedUg / frac / 1000 : Infinity }
  })

  let biomassMg = Math.min(byProtein, byCarb)
  let limitedBy = byProtein <= byCarb ? 'protein / nitrogen' : 'carbon / energy'
  for (const t of byTrace) {
    if (!BIO.biomass.essentialTraces.includes(t.id)) continue
    if (t.supportsMg < biomassMg) {
      biomassMg = t.supportsMg
      limitedBy = t.id === 'heme' ? 'haematin' : t.id === 'thiamine' ? 'thiamine' : t.id
    }
  }
  return { biomassMg, limitedBy, byProtein, byCarb, byTrace }
}
