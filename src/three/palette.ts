/**
 * Colour schemes for the organism.
 *
 * Each scheme is a gradient rather than a single colour, because the whole point
 * of the view is that you can see how established a stretch of network is. The
 * cool end is a path that is merely walked, the hot end a vein carrying
 * cytoplasm. Brightness is applied on top of the gradient, so a tube being
 * reabsorbed slides down the ramp and dims out rather than changing hue.
 */
export interface Palette {
  id: string
  name: string
  /** Swatch for the picker. */
  swatch: string
  /** Tube gradient: barely used, through to a working vein. */
  coolTube: [number, number, number]
  hotTube: [number, number, number]
  /** Additive halo over the busiest routes. */
  glow: [number, number, number]
  /** Deposited slime: everywhere it has searched. */
  slime: [number, number, number]
  slimeWarm: [number, number, number]
  /** Motes, from a hungry searching tip to a fed one sitting in a vein. */
  moteCold: [number, number, number]
  moteWarm: [number, number, number]
  /** A mote in something it is trying to get out of. */
  alarm: [number, number, number]
}

export const PALETTES: Palette[] = [
  {
    id: 'gold',
    name: 'Slime gold',
    swatch: '#f0ae33',
    coolTube: [0.2, 0.34, 0.38],
    hotTube: [1.0, 0.72, 0.06],
    glow: [1.0, 0.66, 0.14],
    slime: [0.1, 0.42, 0.46],
    slimeWarm: [0.6, 0.52, 0.7],
    moteCold: [0.1, 0.85, 1.0],
    moteWarm: [1.0, 0.95, 0.5],
    alarm: [1.0, 0.18, 0.16],
  },
  {
    id: 'cyan',
    name: 'Cold cyan',
    swatch: '#49d8ff',
    coolTube: [0.12, 0.26, 0.4],
    hotTube: [0.42, 0.92, 1.0],
    glow: [0.3, 0.8, 1.0],
    slime: [0.1, 0.3, 0.5],
    slimeWarm: [0.35, 0.6, 0.9],
    moteCold: [0.6, 0.4, 1.0],
    moteWarm: [0.8, 1.0, 1.0],
    alarm: [1.0, 0.18, 0.16],
  },
  {
    id: 'emerald',
    name: 'Emerald',
    swatch: '#5ce08a',
    coolTube: [0.13, 0.3, 0.26],
    hotTube: [0.42, 1.0, 0.52],
    glow: [0.34, 0.95, 0.5],
    slime: [0.1, 0.36, 0.34],
    slimeWarm: [0.45, 0.7, 0.4],
    moteCold: [0.2, 0.7, 1.0],
    moteWarm: [0.85, 1.0, 0.6],
    alarm: [1.0, 0.18, 0.16],
  },
  {
    id: 'magenta',
    name: 'Magenta',
    swatch: '#ef4fb6',
    coolTube: [0.26, 0.15, 0.38],
    hotTube: [1.0, 0.32, 0.82],
    glow: [0.95, 0.26, 0.76],
    slime: [0.22, 0.14, 0.44],
    slimeWarm: [0.6, 0.3, 0.7],
    moteCold: [0.3, 0.8, 1.0],
    moteWarm: [1.0, 0.7, 0.95],
    alarm: [1.0, 0.18, 0.16],
  },
  {
    id: 'ember',
    name: 'Ember',
    swatch: '#ff5c2a',
    coolTube: [0.3, 0.16, 0.13],
    hotTube: [1.0, 0.4, 0.13],
    glow: [1.0, 0.36, 0.1],
    slime: [0.26, 0.16, 0.18],
    slimeWarm: [0.7, 0.34, 0.25],
    moteCold: [1.0, 0.82, 0.3],
    moteWarm: [1.0, 0.5, 0.25],
    alarm: [1.0, 0.18, 0.16],
  },
  {
    id: 'violet',
    name: 'Violet',
    swatch: '#9b7bff',
    coolTube: [0.2, 0.19, 0.42],
    hotTube: [0.68, 0.5, 1.0],
    glow: [0.6, 0.42, 1.0],
    slime: [0.16, 0.2, 0.48],
    slimeWarm: [0.45, 0.4, 0.8],
    moteCold: [0.35, 0.95, 0.95],
    moteWarm: [0.9, 0.8, 1.0],
    alarm: [1.0, 0.18, 0.16],
  },
  {
    id: 'bone',
    name: 'Bone',
    swatch: '#e8ecef',
    coolTube: [0.24, 0.28, 0.32],
    hotTube: [1.0, 0.99, 0.95],
    glow: [0.88, 0.92, 1.0],
    slime: [0.2, 0.26, 0.32],
    slimeWarm: [0.55, 0.6, 0.66],
    moteCold: [0.45, 0.72, 1.0],
    moteWarm: [1.0, 1.0, 1.0],
    alarm: [1.0, 0.18, 0.16],
  },
]

export const PALETTE_BY_ID: Record<string, Palette> = Object.fromEntries(
  PALETTES.map((p) => [p.id, p]),
)

export function getPalette(id: string): Palette {
  return PALETTE_BY_ID[id] ?? PALETTES[0]
}
