/**
 * Experiments. Several are staged versions of real Physarum work: the maze, the
 * nutritional-geometry two-diet choice, the quinine bridge, the long-range
 * foraging runs.
 *
 * Positions are normalised 0..1 within the vessel, so a scenario keeps its shape
 * at any vessel size. Distances quoted in the descriptions are for the vessel
 * size the scenario asks for, where one lattice unit is one millimetre.
 */
import type { EnvParams, SimParams } from './types'
import type { Material } from './solids'

export interface PresetFood {
  defId: string
  at: [number, number, number]
  massMg?: number
}

export interface PresetSolid {
  kindId: string
  at: [number, number, number]
  material?: Material
  scale?: number
  rotated?: boolean
  /** false for a wall the plasmodium cannot climb at all. */
  climbable?: boolean
}

export interface Preset {
  id: string
  name: string
  description: string
  /** Vessel edge length in millimetres. */
  grid?: number
  env?: Partial<EnvParams>
  params?: Partial<SimParams>
  foods: PresetFood[]
  solids?: PresetSolid[]
  inocula: { at: [number, number, number]; motes?: number }[]
}

export const PRESETS: Preset[] = [
  {
    id: 'classic',
    name: 'Oat flakes on agar',
    description:
      'The classic plate, 96 mm across. Starch-rich flakes about 30 mm out - watch it find them, thrive, then stall for want of haematin.',
    grid: 96,
    foods: [
      { defId: 'oat-flake', at: [0.2, 0.06, 0.32] },
      { defId: 'oat-flake', at: [0.78, 0.06, 0.34] },
      { defId: 'oat-flake', at: [0.5, 0.06, 0.82] },
    ],
    inocula: [{ at: [0.5, 0.08, 0.5], motes: 260 }],
  },
  {
    id: 'optimum',
    name: 'Reference medium (2:1)',
    description:
      'Semi-defined broth at the measured 2:1 protein:carbohydrate optimum, pH 4.8, cofactors supplied. This is what unlimited growth looks like.',
    grid: 80,
    env: { substratePh: 5.0, temperatureC: 26 },
    foods: [
      { defId: 'defined-medium', at: [0.3, 0.06, 0.5], massMg: 450 },
      { defId: 'defined-medium', at: [0.7, 0.06, 0.5], massMg: 450 },
    ],
    inocula: [{ at: [0.5, 0.08, 0.5], motes: 240 }],
  },
  {
    id: 'geometry',
    name: 'Nutritional geometry',
    description:
      'Protein one side, carbohydrate the other, colony in the middle. To reach 2:1 it has to hold both ends of a 60 mm network at once.',
    grid: 96,
    foods: [
      { defId: 'peptone-drop', at: [0.14, 0.06, 0.5], massMg: 450 },
      { defId: 'glucose-agar', at: [0.86, 0.06, 0.5], massMg: 450 },
      { defId: 'yeast-extract', at: [0.5, 0.06, 0.14], massMg: 40 },
    ],
    inocula: [{ at: [0.5, 0.08, 0.5], motes: 260 }],
  },
  {
    id: 'maze',
    name: 'Nakagaki maze',
    description:
      'Walls with two openings, food at both ends. It fills the maze, then abandons every dead end and keeps only the shortest path. The walls are sheer, so going over them is not an option.',
    grid: 112,
    env: { gravity: 0.35 },
    solids: [
      { kindId: 'wall', at: [0.34, 0.0, 0.26], material: 'plastic', scale: 0.9, climbable: false },
      { kindId: 'wall', at: [0.34, 0.0, 0.74], material: 'plastic', scale: 0.9, climbable: false },
      { kindId: 'wall', at: [0.66, 0.0, 0.26], material: 'plastic', scale: 0.9, climbable: false },
      { kindId: 'wall', at: [0.66, 0.0, 0.74], material: 'plastic', scale: 0.9, climbable: false },
      { kindId: 'wall', at: [0.5, 0.0, 0.5], material: 'plastic', scale: 0.9, rotated: true, climbable: false },
    ],
    foods: [
      { defId: 'oat-flake', at: [0.08, 0.06, 0.5], massMg: 320 },
      { defId: 'oat-flake', at: [0.92, 0.06, 0.5], massMg: 320 },
    ],
    inocula: [{ at: [0.5, 0.08, 0.12], motes: 300 }],
  },
  {
    id: 'canyon',
    name: 'Canyon crossing',
    description:
      'Two wooden platforms 24 mm apart, on glass legs it cannot climb. The only route to the far side is a span across the gap, and a span only holds if its tube is thick enough to carry the plasmodium. Thin ones sag, then tear.',
    grid: 112,
    env: { gravity: 0.5 },
    solids: [
      { kindId: 'platform', at: [0.26, 0.0, 0.5], material: 'wood', scale: 1.5 },
      { kindId: 'platform', at: [0.74, 0.0, 0.5], material: 'wood', scale: 1.5 },
      { kindId: 'pillar', at: [0.26, 0.0, 0.5], material: 'glass', scale: 0.55 },
      { kindId: 'pillar', at: [0.74, 0.0, 0.5], material: 'glass', scale: 0.55 },
    ],
    foods: [
      { defId: 'defined-medium', at: [0.26, 0.4, 0.5], massMg: 260 },
      { defId: 'liver-puree', at: [0.74, 0.4, 0.5], massMg: 320 },
    ],
    inocula: [{ at: [0.26, 0.42, 0.5], motes: 300 }],
  },
  {
    id: 'tower',
    name: 'Tower climb',
    description:
      'Food 30 mm up a column, and only a snack at the bottom. Build the same tower in glass instead of wood and watch the front fail to hold on.',
    grid: 96,
    env: { gravity: 0.6 },
    solids: [
      { kindId: 'pillar', at: [0.5, 0.0, 0.5], material: 'wood', scale: 0.9 },
      { kindId: 'ramp', at: [0.34, 0.0, 0.5], material: 'wood', scale: 0.85 },
    ],
    foods: [
      { defId: 'bacteria-lawn', at: [0.5, 0.4, 0.5], massMg: 300 },
      { defId: 'oat-flake', at: [0.16, 0.06, 0.5], massMg: 150 },
    ],
    inocula: [{ at: [0.14, 0.08, 0.5], motes: 280 }],
  },
  {
    id: 'long-haul',
    name: 'Long haul',
    description:
      'A 128 mm vessel with one meal 110 mm away and nothing in between. Tests how far a fixed reserve of plasmodium can actually forage.',
    grid: 128,
    env: { gravity: 0.35 },
    foods: [
      { defId: 'liver-puree', at: [0.92, 0.05, 0.5], massMg: 420 },
      { defId: 'defined-medium', at: [0.08, 0.05, 0.5], massMg: 200 },
    ],
    inocula: [{ at: [0.08, 0.07, 0.5], motes: 320 }],
  },
  {
    id: 'shelves',
    name: 'Shelf stack',
    description:
      'Three staggered shelves with a deposit on each. A vertical foraging problem: every level needs a fresh climb.',
    grid: 96,
    env: { gravity: 0.55 },
    solids: [
      { kindId: 'platform', at: [0.3, 0.0, 0.5], material: 'paper', scale: 0.9 },
      { kindId: 'pillar', at: [0.3, 0.0, 0.5], material: 'paper', scale: 0.35 },
      { kindId: 'platform', at: [0.55, 0.3, 0.5], material: 'paper', scale: 0.9 },
      { kindId: 'pillar', at: [0.55, 0.0, 0.5], material: 'paper', scale: 0.6 },
      { kindId: 'platform', at: [0.78, 0.55, 0.5], material: 'paper', scale: 0.9 },
      { kindId: 'pillar', at: [0.78, 0.0, 0.5], material: 'paper', scale: 0.9 },
    ],
    foods: [
      { defId: 'oat-flake', at: [0.3, 0.2, 0.5], massMg: 200 },
      { defId: 'yeast-extract', at: [0.55, 0.45, 0.5], massMg: 40 },
      { defId: 'liver-puree', at: [0.78, 0.7, 0.5], massMg: 260 },
    ],
    inocula: [{ at: [0.12, 0.08, 0.5], motes: 280 }],
  },
  {
    id: 'sugar-trap',
    name: 'Sugar trap',
    description:
      'Banana, honey and milk: plenty of calories, almost no usable nitrogen, and a sugar we cannot even cleave.',
    grid: 80,
    foods: [
      { defId: 'banana', at: [0.24, 0.06, 0.32] },
      { defId: 'honey-drop', at: [0.72, 0.06, 0.3] },
      { defId: 'milk-drop', at: [0.5, 0.06, 0.76] },
    ],
    inocula: [{ at: [0.5, 0.08, 0.5], motes: 260 }],
  },
  {
    id: 'lawn',
    name: 'Bacterial lawn',
    description: 'Its natural diet: whole cells, near 2:1 by composition, complete in cofactors.',
    grid: 80,
    foods: [
      { defId: 'bacteria-lawn', at: [0.3, 0.06, 0.4], massMg: 300 },
      { defId: 'bacteria-lawn', at: [0.68, 0.06, 0.62], massMg: 300 },
    ],
    inocula: [{ at: [0.5, 0.08, 0.5], motes: 240 }],
  },
  {
    id: 'quinine',
    name: 'Quinine gate',
    description:
      'A good meal behind a bitter barrier, with a poor one at home. Well fed, the colony refuses to cross; starved, it pushes through.',
    grid: 96,
    foods: [
      { defId: 'quinine', at: [0.5, 0.05, 0.42] },
      { defId: 'quinine', at: [0.5, 0.05, 0.5] },
      { defId: 'quinine', at: [0.5, 0.05, 0.58] },
      { defId: 'quinine', at: [0.5, 0.05, 0.34] },
      { defId: 'quinine', at: [0.5, 0.05, 0.66] },
      { defId: 'defined-medium', at: [0.86, 0.05, 0.5], massMg: 450 },
      { defId: 'oat-flake', at: [0.16, 0.05, 0.5], massMg: 120 },
    ],
    inocula: [{ at: [0.16, 0.08, 0.5], motes: 260 }],
  },
  {
    id: 'brine',
    name: 'Brine channel',
    description: 'Salt crystals draw a line the plasmodium will not cross. Osmosis, not toxicity.',
    grid: 96,
    foods: [
      { defId: 'salt-crystal', at: [0.48, 0.05, 0.2] },
      { defId: 'salt-crystal', at: [0.48, 0.05, 0.34] },
      { defId: 'salt-crystal', at: [0.48, 0.05, 0.48] },
      { defId: 'salt-crystal', at: [0.48, 0.05, 0.62] },
      { defId: 'salt-crystal', at: [0.48, 0.05, 0.76] },
      { defId: 'liver-puree', at: [0.86, 0.05, 0.5] },
      { defId: 'oat-flake', at: [0.14, 0.05, 0.5] },
    ],
    inocula: [{ at: [0.18, 0.08, 0.5], motes: 260 }],
  },
  {
    id: 'cofactor',
    name: 'Haematin rescue',
    description:
      'Starch and peptone: balanced macros, zero haem. It grows, then arrests with full stores. Drop in liver to watch it resume.',
    grid: 80,
    foods: [
      { defId: 'potato-starch', at: [0.36, 0.06, 0.45], massMg: 260 },
      { defId: 'peptone-drop', at: [0.64, 0.06, 0.55], massMg: 450 },
    ],
    inocula: [{ at: [0.5, 0.08, 0.5], motes: 240 }],
  },
  {
    id: 'gel',
    name: 'Weightless gel',
    description:
      'Gravity off: the vessel behaves as a gel that supports the colony everywhere, and the network grows freely in three dimensions.',
    grid: 96,
    env: { gravity: 0 },
    foods: [
      { defId: 'defined-medium', at: [0.5, 0.82, 0.5], massMg: 300 },
      { defId: 'defined-medium', at: [0.22, 0.34, 0.68], massMg: 300 },
      { defId: 'liver-puree', at: [0.76, 0.6, 0.28], massMg: 300 },
    ],
    inocula: [{ at: [0.5, 0.5, 0.5], motes: 280 }],
  },
  {
    id: 'empty',
    name: 'Empty vessel',
    description:
      'Blank agar, 96 mm. Build the map, place the food, then use the inoculate tool to start a colony.',
    grid: 96,
    foods: [],
    inocula: [],
  },
]

export const PRESET_BY_ID: Record<string, Preset> = Object.fromEntries(
  PRESETS.map((p) => [p.id, p]),
)
