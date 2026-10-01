/**
 * Obstacles: walls, blocks, pillars, platforms, ramps and spheres.
 *
 * A solid does three things. It blocks the plasmodium, which has to route
 * around it or climb it. It blocks diffusion, so nutrient plumes bend around
 * corners and a wall casts a genuine chemical shadow. And it offers a surface to
 * grip: with gravity switched on, the only way up is adhesion to something, and
 * how well the plasmodium grips depends on what the thing is made of.
 */

export type Material = 'agar' | 'paper' | 'wood' | 'plastic' | 'glass' | 'metal'

export interface MaterialDef {
  label: string
  /** 0..1 purchase available to a plasmodium in contact with this surface. */
  adhesion: number
  color: string
  note: string
}

export const MATERIALS: Record<Material, MaterialDef> = {
  agar: {
    label: 'agar',
    adhesion: 1.0,
    color: '#5c7f92',
    note: 'More substrate. The plasmodium simply grows onto it and climbs freely.',
  },
  paper: {
    label: 'filter paper',
    adhesion: 0.92,
    color: '#ded8c6',
    note: 'Absorbent and fibrous - excellent purchase, and it wicks moisture along the surface.',
  },
  wood: {
    label: 'wood',
    adhesion: 0.8,
    color: '#8a6540',
    note: 'Porous and rough. Easy to grip, which is why it is found on rotting logs.',
  },
  plastic: {
    label: 'polystyrene',
    adhesion: 0.5,
    color: '#eef1f4',
    note: 'A Petri dish wall. Climbable, but the front advances slowly up it.',
  },
  glass: {
    label: 'glass',
    adhesion: 0.32,
    color: '#dfe9ef',
    note: 'Smooth and wet. Hard to hold: spans across glass sag and tear first.',
  },
  metal: {
    label: 'steel',
    adhesion: 0.22,
    color: '#9aa3ad',
    note: 'Smooth, cold and unwelcoming. The worst thing here to try to climb.',
  },
}

export type SolidShape = 'box' | 'sphere' | 'ramp'

export interface SolidKindDef {
  id: string
  name: string
  shape: SolidShape
  /** Half-extents in millimetres at scale 1. A sphere uses hx as its radius. */
  half: [number, number, number]
  blurb: string
  /** true if the long axis should be swappable between X and Z. */
  orientable: boolean
}

export const SOLID_KINDS: SolidKindDef[] = [
  {
    id: 'wall',
    name: 'Wall',
    shape: 'box',
    half: [14, 9, 1.2],
    blurb: 'A long thin barrier. Blocks diffusion, so it casts a chemical shadow.',
    orientable: true,
  },
  {
    id: 'block',
    name: 'Block',
    shape: 'box',
    half: [5, 5, 5],
    blurb: 'A cube to route around or climb over.',
    orientable: false,
  },
  {
    id: 'pillar',
    name: 'Pillar',
    shape: 'box',
    half: [2.5, 16, 2.5],
    blurb: 'A tall column. Put food on top and the colony has to climb for it.',
    orientable: false,
  },
  {
    id: 'platform',
    name: 'Platform',
    shape: 'box',
    half: [10, 1.2, 10],
    blurb: 'A flat shelf. Two of them with a gap between is the bridging experiment.',
    orientable: false,
  },
  {
    id: 'ramp',
    name: 'Ramp',
    shape: 'ramp',
    half: [11, 8, 7],
    blurb: 'A slope rising along X. An easier way up than a vertical face.',
    orientable: true,
  },
  {
    id: 'sphere',
    name: 'Sphere',
    shape: 'sphere',
    half: [6, 6, 6],
    blurb: 'A bead. Nothing to grip at the top, so the colony tends to skirt it.',
    orientable: false,
  },
]

export const SOLID_KIND_BY_ID: Record<string, SolidKindDef> = Object.fromEntries(
  SOLID_KINDS.map((k) => [k.id, k]),
)

export interface SolidInstance {
  id: string
  kindId: string
  shape: SolidShape
  material: Material
  /** Centre, in vessel millimetres. */
  x: number
  y: number
  z: number
  /** Half-extents, in vessel millimetres. */
  hx: number
  hy: number
  hz: number
  /** Ramps rise along +X when false, along +Z when true. */
  rotated: boolean
  /**
   * Rotation about the vertical axis, in radians. The occupancy test rotates the
   * sample point into the object's own frame, so this costs nothing at run time:
   * it is paid once, when the object is rasterised into the mask.
   */
  yaw: number
  /**
   * A sheer object offers no purchase at all: the plasmodium cannot grip it, is
   * not attracted along it, and cannot go up beside it. Use it to build a maze
   * whose walls are a genuine constraint rather than an obstacle it can crawl
   * over given enough time. It only means something under gravity: in gel mode
   * nothing is held down anywhere, so there is no climbing to prevent.
   */
  climbable: boolean
}

let solidSeq = 0

/** Full size in millimetres of a kind at a given uniform scale. */
export function kindSize(kindId: string, scale = 1): [number, number, number] {
  const kind = SOLID_KIND_BY_ID[kindId]
  if (!kind) return [10, 10, 10]
  return [kind.half[0] * 2 * scale, kind.half[1] * 2 * scale, kind.half[2] * 2 * scale]
}

export function createSolid(
  kindId: string,
  material: Material,
  x: number,
  y: number,
  z: number,
  scale = 1,
  rotated = false,
  /** Full dimensions in millimetres. Overrides `scale` when given. */
  dims?: [number, number, number],
  climbable = true,
  yaw = 0,
): SolidInstance | null {
  const kind = SOLID_KIND_BY_ID[kindId]
  if (!kind) return null
  let [hx, hy, hz] = dims
    ? ([dims[0] / 2, dims[1] / 2, dims[2] / 2] as [number, number, number])
    : kind.half
  if (!dims) {
    hx *= scale
    hy *= scale
    hz *= scale
  }
  if (kind.shape === 'sphere') {
    // A sphere uses hx as its radius, so keep it round whatever the sliders say.
    hy = hx
    hz = hx
  }
  if (rotated && kind.orientable && kind.shape === 'box') {
    const t = hx
    hx = hz
    hz = t
  }
  return {
    id: `s${++solidSeq}`,
    kindId,
    shape: kind.shape,
    material,
    x,
    y,
    z,
    hx,
    hy,
    hz,
    rotated,
    climbable,
    yaw,
  }
}

/** Rotate a world offset into the object's own frame. */
function toLocal(s: SolidInstance, dx: number, dz: number): [number, number] {
  if (!s.yaw) return [dx, dz]
  const c = Math.cos(-s.yaw)
  const si = Math.sin(-s.yaw)
  return [dx * c - dz * si, dx * si + dz * c]
}

export function solidContains(s: SolidInstance, x: number, y: number, z: number): boolean {
  const dy = y - s.y
  const wx = x - s.x
  const wz = z - s.z
  if (s.shape === 'sphere') {
    return wx * wx + dy * dy + wz * wz <= s.hx * s.hx
  }
  const [dx, dz] = toLocal(s, wx, wz)
  if (Math.abs(dx) > s.hx || Math.abs(dy) > s.hy || Math.abs(dz) > s.hz) return false
  if (s.shape === 'ramp') {
    // Solid below a plane rising from the low end to the high end.
    const along = s.rotated ? dz / s.hz : dx / s.hx
    const surface = -s.hy + (along + 1) * s.hy
    return dy <= surface
  }
  return true
}

/** Axis-aligned bounds of the rotated object, in millimetres. */
export function solidBounds(s: SolidInstance): [number, number, number, number, number, number] {
  let ex = s.hx
  let ez = s.hz
  if (s.yaw) {
    const c = Math.abs(Math.cos(s.yaw))
    const si = Math.abs(Math.sin(s.yaw))
    ex = s.hx * c + s.hz * si
    ez = s.hx * si + s.hz * c
  }
  return [s.x - ex, s.y - s.hy, s.z - ez, s.x + ex, s.y + s.hy, s.z + ez]
}

export function solidTopAt(s: SolidInstance, x: number, z: number): number | null {
  const wx = x - s.x
  const wz = z - s.z
  if (s.shape === 'sphere') {
    const r2 = s.hx * s.hx - wx * wx - wz * wz
    return r2 <= 0 ? null : s.y + Math.sqrt(r2)
  }
  const [dx, dz] = toLocal(s, wx, wz)
  if (Math.abs(dx) > s.hx || Math.abs(dz) > s.hz) return null
  if (s.shape === 'ramp') {
    const along = s.rotated ? dz / s.hz : dx / s.hx
    return s.y - s.hy + (along + 1) * s.hy
  }
  return s.y + s.hy
}
