/**
 * A 3D scalar field on a uniform lattice, with explicit diffusion and decay.
 *
 * Used for the two substrate currencies (carbon-equivalent and protein-equivalent),
 * for the slime trail, and for a biomass density map. World coordinates run
 * 0..worldSize on every axis; voxel centres sit at integer + 0.5.
 */
export interface FieldRegion {
  x0: number
  y0: number
  z0: number
  x1: number
  y1: number
  z1: number
}

export interface Obstacles {
  /** 1 where a solid occupies the voxel. */
  mask: Uint8Array
  /** Non-solid voxels with at least one solid neighbour. */
  boundary: Int32Array
  /** Solid voxel indices, which are always held at zero. */
  solid: Int32Array
}

export class Field3D {
  readonly n: number
  readonly worldSize: number
  private readonly toVoxel: number
  data: Float32Array
  private tmp: Float32Array

  /**
   * `diffusible` false skips the scratch buffer. A field that is only deposited
   * into and decayed - the tube network, the biomass map - never calls step(),
   * and at a 160 mm vessel that second buffer is 16 MB it would never touch.
   */
  constructor(n: number, worldSize = n, diffusible = true) {
    this.n = n
    this.worldSize = worldSize
    this.toVoxel = n / worldSize
    this.data = new Float32Array(n * n * n)
    this.tmp = diffusible ? new Float32Array(n * n * n) : this.data
  }

  clear(): void {
    this.data.fill(0)
  }

  private clampIndex(v: number): number {
    const i = Math.floor(v * this.toVoxel)
    return i < 0 ? 0 : i >= this.n ? this.n - 1 : i
  }

  index(x: number, y: number, z: number): number {
    const n = this.n
    return this.clampIndex(x) + n * (this.clampIndex(y) + n * this.clampIndex(z))
  }

  /** Nearest-voxel read. Cheap enough for per-sensor sampling. */
  nearest(x: number, y: number, z: number): number {
    return this.data[this.index(x, y, z)]
  }

  addAt(x: number, y: number, z: number, amount: number): void {
    this.data[this.index(x, y, z)] += amount
  }

  setAt(x: number, y: number, z: number, value: number): void {
    this.data[this.index(x, y, z)] = value
  }

  /** Remove up to `want` from the voxel containing the point; returns what was actually taken. */
  take(x: number, y: number, z: number, want: number): number {
    if (want <= 0) return 0
    const i = this.index(x, y, z)
    const have = this.data[i]
    if (have <= 0) return 0
    const got = have < want ? have : want
    this.data[i] = have - got
    return got
  }

  /** Trilinear read, for smooth gradients where it matters. */
  sample(x: number, y: number, z: number): number {
    const n = this.n
    const s = this.toVoxel
    let fx = x * s - 0.5
    let fy = y * s - 0.5
    let fz = z * s - 0.5
    const max = n - 1
    if (fx < 0) fx = 0
    else if (fx > max) fx = max
    if (fy < 0) fy = 0
    else if (fy > max) fy = max
    if (fz < 0) fz = 0
    else if (fz > max) fz = max
    const ix = fx | 0
    const iy = fy | 0
    const iz = fz | 0
    const ix1 = ix + 1 > max ? max : ix + 1
    const iy1 = iy + 1 > max ? max : iy + 1
    const iz1 = iz + 1 > max ? max : iz + 1
    const tx = fx - ix
    const ty = fy - iy
    const tz = fz - iz
    const d = this.data
    const nn = n * n
    const z0 = iz * nn
    const z1 = iz1 * nn
    const y0 = iy * n
    const y1 = iy1 * n
    const c000 = d[z0 + y0 + ix]
    const c100 = d[z0 + y0 + ix1]
    const c010 = d[z0 + y1 + ix]
    const c110 = d[z0 + y1 + ix1]
    const c001 = d[z1 + y0 + ix]
    const c101 = d[z1 + y0 + ix1]
    const c011 = d[z1 + y1 + ix]
    const c111 = d[z1 + y1 + ix1]
    const c00 = c000 + (c100 - c000) * tx
    const c10 = c010 + (c110 - c010) * tx
    const c01 = c001 + (c101 - c001) * tx
    const c11 = c011 + (c111 - c011) * tx
    const c0 = c00 + (c10 - c00) * ty
    const c1 = c01 + (c11 - c01) * ty
    return c0 + (c1 - c0) * tz
  }

  /**
   * One explicit diffusion + decay step.
   *
   * `mix` is the lattice mixing coefficient (stable for 0..1) and `decay` is the
   * fraction removed this step. `region` restricts the work to the part of the
   * lattice that can hold anything: it must contain every non-zero voxel and
   * grow by at least one voxel per step, which is what makes a large vessel
   * affordable. `obstacles` makes solid voxels no-flux walls rather than sinks.
   */
  step(mix: number, decay: number, region?: FieldRegion, obstacles?: Obstacles): void {
    const n = this.n
    const nn = n * n
    const data = this.data
    const tmp = this.tmp
    const keep = 1 - decay
    const m = mix < 0 ? 0 : mix > 1 ? 1 : mix
    const sixth = m / 6
    const zLo = Math.max(1, region ? region.z0 : 1)
    const zHi = Math.min(n - 1, region ? region.z1 + 1 : n - 1)
    const yLo = Math.max(1, region ? region.y0 : 1)
    const yHi = Math.min(n - 1, region ? region.y1 + 1 : n - 1)
    const xLo = Math.max(1, region ? region.x0 : 1)
    const xHi = Math.min(n - 1, region ? region.x1 + 1 : n - 1)

    for (let z = zLo; z < zHi; z++) {
      const zo = z * nn
      for (let y = yLo; y < yHi; y++) {
        const yo = zo + y * n
        for (let x = xLo; x < xHi; x++) {
          const i = yo + x
          const c = data[i]
          const sum =
            data[i - 1] + data[i + 1] + data[i - n] + data[i + n] + data[i - nn] + data[i + nn]
          tmp[i] = (c * (1 - m) + sum * sixth) * keep
        }
      }
    }
    // Vessel-wall shell: decay only. Approximates a zero-flux wall well enough,
    // and the plasmodium is kept away from the wall anyway. While the active
    // region has not reached the wall the shell is provably empty, so skip it.
    const touchesWall =
      !region ||
      region.x0 <= 0 ||
      region.y0 <= 0 ||
      region.z0 <= 0 ||
      region.x1 >= n - 1 ||
      region.y1 >= n - 1 ||
      region.z1 >= n - 1
    if (touchesWall)
    for (let z = 0; z < n; z++) {
      const zo = z * nn
      const edgeZ = z === 0 || z === n - 1
      for (let y = 0; y < n; y++) {
        const yo = zo + y * n
        if (edgeZ || y === 0 || y === n - 1) {
          for (let x = 0; x < n; x++) tmp[yo + x] = data[yo + x] * keep
        } else {
          tmp[yo] = data[yo] * keep
          tmp[yo + n - 1] = data[yo + n - 1] * keep
        }
      }
    }

    if (obstacles) {
      // Redo the voxels that touch a solid, this time treating the solid face as
      // a no-flux wall: substituting the centre value for a blocked neighbour
      // means nothing crosses it and nothing is lost into it.
      const { mask, boundary, solid } = obstacles
      const last = n - 1
      for (let b = 0; b < boundary.length; b++) {
        const i = boundary[b]
        const x = i % n
        const y = ((i - x) / n) % n
        const z = (i - x - y * n) / nn
        const c = data[i]
        const xm = x > 0 ? i - 1 : i
        const xp = x < last ? i + 1 : i
        const ym = y > 0 ? i - n : i
        const yp = y < last ? i + n : i
        const zm = z > 0 ? i - nn : i
        const zp = z < last ? i + nn : i
        const sum =
          (mask[xm] ? c : data[xm]) +
          (mask[xp] ? c : data[xp]) +
          (mask[ym] ? c : data[ym]) +
          (mask[yp] ? c : data[yp]) +
          (mask[zm] ? c : data[zm]) +
          (mask[zp] ? c : data[zp])
        tmp[i] = (c * (1 - m) + sum * sixth) * keep
      }
      for (let k = 0; k < solid.length; k++) tmp[solid[k]] = 0
    }

    this.data = tmp
    this.tmp = data
  }

  /**
   * Sum of the field. A region may be supplied to skip the parts of the lattice
   * that cannot hold anything yet, which is most of a large vessel.
   */
  total(region?: FieldRegion): number {
    const d = this.data
    let s = 0
    if (!region) {
      for (let i = 0; i < d.length; i++) s += d[i]
      return s
    }
    const n = this.n
    const nn = n * n
    for (let z = region.z0; z <= region.z1; z++) {
      for (let y = region.y0; y <= region.y1; y++) {
        const row = nn * z + n * y
        for (let x = region.x0; x <= region.x1; x++) s += d[row + x]
      }
    }
    return s
  }

  countAbove(threshold: number, region?: FieldRegion): number {
    const d = this.data
    let c = 0
    if (!region) {
      for (let i = 0; i < d.length; i++) if (d[i] > threshold) c++
      return c
    }
    const n = this.n
    const nn = n * n
    for (let z = region.z0; z <= region.z1; z++) {
      for (let y = region.y0; y <= region.y1; y++) {
        const row = nn * z + n * y
        for (let x = region.x0; x <= region.x1; x++) if (d[row + x] > threshold) c++
      }
    }
    return c
  }

  /** Zero just the active region, rather than refilling the whole lattice. */
  clearRegion(region: FieldRegion): void {
    const n = this.n
    const nn = n * n
    const d = this.data
    for (let z = region.z0; z <= region.z1; z++) {
      for (let y = region.y0; y <= region.y1; y++) {
        const row = nn * z + n * y
        d.fill(0, row + region.x0, row + region.x1 + 1)
      }
    }
  }
}

/** Cached spherical deposition kernels, keyed by radius. */
const kernelCache = new Map<
  string,
  { dx: Int16Array; dy: Int16Array; dz: Int16Array; w: Float32Array }
>()

/**
 * Spread `amount` over a soft sphere of the given radius (in world units)
 * centred on a point, normalised so nothing is created or lost.
 */
export function depositSphere(
  field: Field3D,
  x: number,
  y: number,
  z: number,
  radius: number,
  amount: number,
): void {
  if (amount === 0) return
  const n = field.n
  const r = Math.max(0.6, radius * (n / field.worldSize))
  const key = `${n}:${r.toFixed(2)}`
  let k = kernelCache.get(key)
  if (!k) {
    const ir = Math.ceil(r)
    const ox: number[] = []
    const oy: number[] = []
    const oz: number[] = []
    const w: number[] = []
    let sum = 0
    for (let dz = -ir; dz <= ir; dz++) {
      for (let dy = -ir; dy <= ir; dy++) {
        for (let dx = -ir; dx <= ir; dx++) {
          const d2 = dx * dx + dy * dy + dz * dz
          if (d2 > r * r) continue
          const weight = Math.exp((-1.5 * d2) / (r * r))
          ox.push(dx)
          oy.push(dy)
          oz.push(dz)
          w.push(weight)
          sum += weight
        }
      }
    }
    const wf = new Float32Array(w.length)
    for (let i = 0; i < w.length; i++) wf[i] = w[i] / sum
    k = { dx: Int16Array.from(ox), dy: Int16Array.from(oy), dz: Int16Array.from(oz), w: wf }
    kernelCache.set(key, k)
  }
  // Clamp each axis independently so a deposit near a wall piles up against it
  // instead of wrapping around to the far side of the vessel.
  const s = n / field.worldSize
  const cx = Math.floor(x * s)
  const cy = Math.floor(y * s)
  const cz = Math.floor(z * s)
  const d = field.data
  const last = n - 1
  for (let i = 0; i < k.w.length; i++) {
    let vx = cx + k.dx[i]
    let vy = cy + k.dy[i]
    let vz = cz + k.dz[i]
    vx = vx < 0 ? 0 : vx > last ? last : vx
    vy = vy < 0 ? 0 : vy > last ? last : vy
    vz = vz < 0 ? 0 : vz > last ? last : vz
    d[vx + n * (vy + n * vz)] += amount * k.w[i]
  }
}
