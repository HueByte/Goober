/**
 * Sparse 3D scalar fields on a uniform 1 mm lattice.
 *
 * A one-metre vessel is 10^9 voxels. Stored densely that is tens of gigabytes
 * of field, nearly all of it bare agar that will never hold anything - so the
 * lattice is not stored densely. It is cut into 16 mm bricks, and a brick is
 * allocated the first time something is written into it. The organism occupies
 * a thin shell of a big vessel, so the cost follows the colony rather than the
 * container, and a metre of empty space is free.
 *
 * Every field in a vessel shares one brick table. That matters more than it
 * looks: it means a voxel has a single index that is valid in all of them, so
 * the biomass map, the solid mask and the tube network can all be read with the
 * same number - which is what the rest of the simulation already assumed when
 * the lattice was flat.
 *
 * Slot 0 is a brick of permanent zeroes. Reading an unallocated brick lands
 * there and gives back nothing, which is the correct answer, and is why a read
 * never has to allocate.
 *
 * World coordinates run 0..n on every axis and voxel centres sit at integer +
 * 0.5, exactly as before.
 */

/**
 * Below this a brick counts as empty. Field values are micrograms per voxel and
 * tube thickness in arbitrary units, so this is far beneath anything that could
 * be seen or eaten.
 */
export const FIELD_EPS = 1e-4

/** Edge of a brick, in voxels. 16^3 = 4096 cells, 16 kB of float. */
export const BRICK = 16
const BRICK_SHIFT = 4
const BRICK_MASK = BRICK - 1
const BRICK_CELLS = BRICK * BRICK * BRICK

export interface FieldRegion {
  x0: number
  y0: number
  z0: number
  x1: number
  y1: number
  z1: number
}

export interface Obstacles {
  /** The solid mask, sharing this lattice's indices. */
  mask: Uint8Array
  /** Non-solid voxels with at least one solid neighbour. */
  boundary: Int32Array
  /** The six neighbour indices of each boundary voxel, in order -x +x -y +y -z +z. */
  boundaryNb: Int32Array
  /** Solid voxel indices, which are always held at zero. */
  solid: Int32Array
}

interface Store {
  /** Grow the backing array to hold `slots` bricks. */
  grow(slots: number): void
  /** Zero the given slot. */
  zero(slot: number): void
  /** Bytes this field costs per voxel, for the memory read-out. */
  readonly bytesPerCell: number
}

/**
 * The brick table, shared by every field in one vessel.
 *
 * It hands out translated indices: `slot * 4096 + offset within the brick`.
 * Those indices are opaque - they are not `x + n*(y + n*z)` any more - so
 * anything that wants to walk the lattice goes through `forEachBrick` rather
 * than doing arithmetic on them.
 */
export class Lattice {
  readonly n: number
  /** Bricks per axis. */
  readonly nb: number
  /** Brick index -> slot, or -1 when the brick has never been written to. */
  private table: Int32Array
  /** Slot -> brick index, for iteration. Slot 0 is the zero brick. */
  private slotBrick: Int32Array
  /** Allocated slots, including the zero brick. */
  count = 1
  /** Slots handed back by reclamation, waiting to be reused. */
  private free: number[] = []
  private capacity = 1
  private stores: Store[] = []
  /**
   * How many bricks this vessel may allocate. Hitting it does not fail: writes
   * outside the allocated set simply land in the zero brick and are discarded,
   * which caps the colony's footprint rather than the session.
   */
  maxBricks: number
  /** Set once the budget has been reached, so the UI can say so. */
  exhausted = false

  constructor(n: number, maxBricks = 24_000) {
    this.n = n
    this.nb = Math.ceil(n / BRICK)
    this.table = new Int32Array(this.nb ** 3).fill(-1)
    this.slotBrick = new Int32Array(8)
    this.maxBricks = maxBricks
    this.reserve(64)
  }

  /** Bytes of field storage currently committed. */
  get allocatedBytes(): number {
    let perCell = 0
    for (const s of this.stores) perCell += s.bytesPerCell
    return this.count * BRICK_CELLS * perCell
  }

  register(store: Store): void {
    this.stores.push(store)
    store.grow(this.capacity)
  }

  private reserve(slots: number): void {
    if (slots <= this.capacity) return
    let cap = this.capacity
    while (cap < slots) cap *= 2
    const nextBrick = new Int32Array(cap)
    nextBrick.set(this.slotBrick)
    this.slotBrick = nextBrick
    this.capacity = cap
    for (const s of this.stores) s.grow(cap)
  }

  private clampVoxel(v: number): number {
    const i = Math.floor(v)
    return i < 0 ? 0 : i >= this.n ? this.n - 1 : i
  }

  /**
   * Read index. Never allocates; an untouched brick resolves to the zero brick,
   * so every read of empty space costs one table lookup and returns zero.
   */
  index(x: number, y: number, z: number): number {
    const vx = this.clampVoxel(x)
    const vy = this.clampVoxel(y)
    const vz = this.clampVoxel(z)
    const nb = this.nb
    const slot =
      this.table[
        (vx >> BRICK_SHIFT) + nb * ((vy >> BRICK_SHIFT) + nb * (vz >> BRICK_SHIFT))
      ]
    if (slot < 0) return 0
    return (
      slot * BRICK_CELLS +
      ((vz & BRICK_MASK) << 8) +
      ((vy & BRICK_MASK) << 4) +
      (vx & BRICK_MASK)
    )
  }

  /** Write index. Allocates the brick if this is the first thing to go into it. */
  cell(x: number, y: number, z: number): number {
    const vx = this.clampVoxel(x)
    const vy = this.clampVoxel(y)
    const vz = this.clampVoxel(z)
    const nb = this.nb
    const b = (vx >> BRICK_SHIFT) + nb * ((vy >> BRICK_SHIFT) + nb * (vz >> BRICK_SHIFT))
    let slot = this.table[b]
    if (slot < 0) {
      slot = this.allocate(b)
      if (slot < 0) return 0
    }
    return (
      slot * BRICK_CELLS +
      ((vz & BRICK_MASK) << 8) +
      ((vy & BRICK_MASK) << 4) +
      (vx & BRICK_MASK)
    )
  }

  private allocate(brick: number): number {
    const recycled = this.free.pop()
    if (recycled !== undefined) {
      this.slotBrick[recycled] = brick
      this.table[brick] = recycled
      for (const s of this.stores) s.zero(recycled)
      return recycled
    }
    if (this.count >= this.maxBricks) {
      this.exhausted = true
      return -1
    }
    const slot = this.count++
    this.reserve(this.count)
    this.slotBrick[slot] = brick
    this.table[brick] = slot
    for (const s of this.stores) s.zero(slot)
    return slot
  }

  /** The slot holding a brick, or 0 if it has never been written to. */
  slotAt(bx: number, by: number, bz: number): number {
    if (bx < 0 || by < 0 || bz < 0 || bx >= this.nb || by >= this.nb || bz >= this.nb) return 0
    const slot = this.table[bx + this.nb * (by + this.nb * bz)]
    return slot < 0 ? 0 : slot
  }

  /**
   * Hand a brick back. Everything in it must already be zero; the slot goes on
   * the free list and the next brick the colony reaches into will reuse it.
   * This is what stops a wandering organism costing more and more the longer it
   * runs - the ground it has finished with is given up, not just forgotten.
   */
  release(slot: number): void {
    if (slot <= 0 || slot >= this.count) return
    const b = this.slotBrick[slot]
    if (this.table[b] !== slot) return
    this.table[b] = -1
    this.slotBrick[slot] = -1
    this.free.push(slot)
    this.exhausted = false
  }

  /** Bricks actually in use, as opposed to allocated and handed back. */
  get liveBricks(): number {
    return this.count - 1 - this.free.length
  }

  /** Walk every allocated brick. The zero brick is never visited. */
  forEachBrick(fn: (slot: number, bx: number, by: number, bz: number) => void): void {
    const nb = this.nb
    for (let slot = 1; slot < this.count; slot++) {
      const b = this.slotBrick[slot]
      if (b < 0) continue
      const bx = b % nb
      const by = ((b - bx) / nb) % nb
      const bz = (b - bx - by * nb) / (nb * nb)
      fn(slot, bx, by, bz)
    }
  }

  /** Walk the allocated bricks that intersect a region, in voxel coordinates. */
  forEachBrickIn(
    region: FieldRegion | undefined,
    fn: (slot: number, bx: number, by: number, bz: number) => void,
  ): void {
    if (!region) return this.forEachBrick(fn)
    const bx0 = Math.max(0, Math.floor(region.x0) >> BRICK_SHIFT)
    const by0 = Math.max(0, Math.floor(region.y0) >> BRICK_SHIFT)
    const bz0 = Math.max(0, Math.floor(region.z0) >> BRICK_SHIFT)
    const bx1 = Math.min(this.nb - 1, Math.floor(region.x1) >> BRICK_SHIFT)
    const by1 = Math.min(this.nb - 1, Math.floor(region.y1) >> BRICK_SHIFT)
    const bz1 = Math.min(this.nb - 1, Math.floor(region.z1) >> BRICK_SHIFT)
    const nb = this.nb
    for (let bz = bz0; bz <= bz1; bz++)
      for (let by = by0; by <= by1; by++)
        for (let bx = bx0; bx <= bx1; bx++) {
          const slot = this.table[bx + nb * (by + nb * bz)]
          if (slot > 0) fn(slot, bx, by, bz)
        }
  }

  /** Forget every allocation. Fields keep their arrays; the data is orphaned. */
  reset(): void {
    this.table.fill(-1)
    this.count = 1
    this.free.length = 0
    this.exhausted = false
    for (const s of this.stores) s.zero(0)
  }
}

/** Shared bookkeeping for a field stored brick-wise over a lattice. */
abstract class BrickStore<A extends Float32Array | Uint8Array> implements Store {
  readonly lattice: Lattice
  readonly n: number
  data!: A
  abstract readonly bytesPerCell: number
  protected abstract make(len: number): A

  constructor(lattice: Lattice) {
    this.lattice = lattice
    this.n = lattice.n
  }

  grow(slots: number): void {
    const want = slots * BRICK_CELLS
    if (this.data && this.data.length >= want) return
    const next = this.make(want)
    if (this.data) next.set(this.data)
    this.data = next
  }

  zero(slot: number): void {
    this.data.fill(0, slot * BRICK_CELLS, (slot + 1) * BRICK_CELLS)
  }

  index(x: number, y: number, z: number): number {
    return this.lattice.index(x, y, z)
  }

  /** Index that is safe to write to: allocates the brick if need be. */
  cell(x: number, y: number, z: number): number {
    return this.lattice.cell(x, y, z)
  }

  clear(): void {
    this.data.fill(0)
  }
}

export class Field3D extends BrickStore<Float32Array> {
  readonly bytesPerCell: number
  private tmp: Float32Array | null = null
  private readonly diffusible: boolean
  /**
   * The largest value in each brick, as of the last integration.
   *
   * This is the whole of the optimisation: a brick that holds nothing, and all
   * of whose neighbours hold nothing, cannot acquire anything by diffusing, so
   * there is no point integrating it. Most of a vessel the colony has moved on
   * from is exactly that, and the saving is proportional to how much of the
   * plate is quiet - which, in a big vessel, is nearly all of it.
   */
  brickMax!: Float32Array
  /** Scratch brick with a one-voxel halo, reused by every diffusion step. */
  private static halo = new Float32Array((BRICK + 2) ** 3)

  protected make(len: number): Float32Array {
    return new Float32Array(len)
  }

  /**
   * `diffusible` false skips the second buffer. A field that is only deposited
   * into and decayed - the tube network, the biomass map - never calls step().
   */
  constructor(lattice: Lattice, diffusible = true) {
    super(lattice)
    this.diffusible = diffusible
    this.bytesPerCell = diffusible ? 8 : 4
    lattice.register(this)
  }

  grow(slots: number): void {
    super.grow(slots)
    if (!this.brickMax || this.brickMax.length < slots) {
      const nextMax = new Float32Array(slots)
      if (this.brickMax) nextMax.set(this.brickMax)
      this.brickMax = nextMax
    }
    if (this.diffusible) {
      const want = slots * BRICK_CELLS
      if (!this.tmp || this.tmp.length < want) {
        const next = new Float32Array(want)
        if (this.tmp) next.set(this.tmp)
        this.tmp = next
      }
    }
  }

  zero(slot: number): void {
    super.zero(slot)
    if (this.brickMax) this.brickMax[slot] = 0
    if (this.tmp) this.tmp.fill(0, slot * BRICK_CELLS, (slot + 1) * BRICK_CELLS)
  }

  /** Recompute a brick's high-water mark. Used by fields that never diffuse. */
  rescanBrick(slot: number): number {
    const base = slot * BRICK_CELLS
    const d = this.data
    let max = 0
    for (let k = 0; k < BRICK_CELLS; k++) {
      const v = d[base + k]
      if (v > max) max = v
    }
    this.brickMax[slot] = max
    return max
  }

  clear(): void {
    super.clear()
    if (this.brickMax) this.brickMax.fill(0)
    if (this.tmp) this.tmp.fill(0)
  }

  /** Nearest-voxel read. Cheap enough for per-sensor sampling. */
  nearest(x: number, y: number, z: number): number {
    return this.data[this.lattice.index(x, y, z)]
  }

  addAt(x: number, y: number, z: number, amount: number): void {
    if (amount === 0) return
    const i = this.lattice.cell(x, y, z)
    const v = (this.data[i] += amount)
    const slot = (i / BRICK_CELLS) | 0
    if (v > this.brickMax[slot]) this.brickMax[slot] = v
  }

  setAt(x: number, y: number, z: number, value: number): void {
    const i = this.lattice.cell(x, y, z)
    this.data[i] = value
    const slot = (i / BRICK_CELLS) | 0
    if (value > this.brickMax[slot]) this.brickMax[slot] = value
  }

  /** Tell the field a direct write to `data` happened, so the brick stays live. */
  touch(index: number, value: number): void {
    const slot = (index / BRICK_CELLS) | 0
    if (value > this.brickMax[slot]) this.brickMax[slot] = value
  }

  /** Remove up to `want` from the voxel containing the point; returns what was taken. */
  take(x: number, y: number, z: number, want: number): number {
    if (want <= 0) return 0
    const i = this.lattice.index(x, y, z)
    const have = this.data[i]
    if (have <= 0) return 0
    const got = have < want ? have : want
    this.data[i] = have - got
    return got
  }

  /** Trilinear read, for smooth gradients where it matters. */
  sample(x: number, y: number, z: number): number {
    const max = this.n - 1
    let fx = x - 0.5
    let fy = y - 0.5
    let fz = z - 0.5
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
    const L = this.lattice
    const c000 = d[L.index(ix, iy, iz)]
    const c100 = d[L.index(ix1, iy, iz)]
    const c010 = d[L.index(ix, iy1, iz)]
    const c110 = d[L.index(ix1, iy1, iz)]
    const c001 = d[L.index(ix, iy, iz1)]
    const c101 = d[L.index(ix1, iy, iz1)]
    const c011 = d[L.index(ix, iy1, iz1)]
    const c111 = d[L.index(ix1, iy1, iz1)]
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
   * fraction removed this step. The work is done brick by brick: each brick is
   * gathered into a scratch copy with a one-voxel halo, so the stencil inside it
   * is plain contiguous arithmetic and only the halo pays for the indirection.
   * `region` skips bricks that cannot hold anything, and `obstacles` makes solid
   * voxels no-flux walls rather than sinks.
   */
  step(mix: number, decay: number, region?: FieldRegion, obstacles?: Obstacles): void {
    const tmp = this.tmp
    if (!tmp) return
    const data = this.data
    const L = this.lattice
    const keep = 1 - decay
    const m = mix < 0 ? 0 : mix > 1 ? 1 : mix
    const sixth = m / 6
    const halo = Field3D.halo
    const H = BRICK + 2
    const HH = H * H
    const last = this.n - 1

    const maxes = this.brickMax
    L.forEachBrickIn(region, (slot, bx, by, bz) => {
      // Nothing here, and nothing next door that could flow in: there is no
      // arithmetic worth doing. In a vessel the colony has moved across, this
      // is most of it.
      if (
        maxes[slot] < FIELD_EPS &&
        maxes[L.slotAt(bx - 1, by, bz)] < FIELD_EPS &&
        maxes[L.slotAt(bx + 1, by, bz)] < FIELD_EPS &&
        maxes[L.slotAt(bx, by - 1, bz)] < FIELD_EPS &&
        maxes[L.slotAt(bx, by + 1, bz)] < FIELD_EPS &&
        maxes[L.slotAt(bx, by, bz - 1)] < FIELD_EPS &&
        maxes[L.slotAt(bx, by, bz + 1)] < FIELD_EPS
      )
        return
      const ox = bx * BRICK
      const oy = by * BRICK
      const oz = bz * BRICK
      // Gather this brick plus a one-voxel skin of its neighbours. Inside the
      // brick that is a straight copy; the skin is where the brick table gets
      // consulted, which is 1 lookup per face voxel rather than per cell.
      const base = slot * BRICK_CELLS
      for (let lz = 0; lz < BRICK; lz++) {
        for (let ly = 0; ly < BRICK; ly++) {
          const src = base + (lz << 8) + (ly << 4)
          const dst = (lz + 1) * HH + (ly + 1) * H + 1
          for (let lx = 0; lx < BRICK; lx++) halo[dst + lx] = data[src + lx]
        }
      }
      // The skin, one face at a time. At the vessel wall the neighbour is the
      // voxel itself, which makes the wall no-flux: nothing crosses it and
      // nothing is lost through it. Reading a zero there instead would quietly
      // drain the plate through its own floor.
      for (let lz = 0; lz < BRICK; lz++) {
        for (let ly = 0; ly < BRICK; ly++) {
          const row = (lz + 1) * HH + (ly + 1) * H
          halo[row] = ox > 0 ? data[L.index(ox - 1, oy + ly, oz + lz)] : halo[row + 1]
          halo[row + BRICK + 1] =
            ox + BRICK <= last ? data[L.index(ox + BRICK, oy + ly, oz + lz)] : halo[row + BRICK]
        }
      }
      for (let lz = 0; lz < BRICK; lz++) {
        for (let lx = 0; lx < BRICK; lx++) {
          const col = (lz + 1) * HH + (lx + 1)
          halo[col] = oy > 0 ? data[L.index(ox + lx, oy - 1, oz + lz)] : halo[col + H]
          halo[col + (BRICK + 1) * H] =
            oy + BRICK <= last
              ? data[L.index(ox + lx, oy + BRICK, oz + lz)]
              : halo[col + BRICK * H]
        }
      }
      for (let ly = 0; ly < BRICK; ly++) {
        for (let lx = 0; lx < BRICK; lx++) {
          const c = (ly + 1) * H + (lx + 1)
          halo[c] = oz > 0 ? data[L.index(ox + lx, oy + ly, oz - 1)] : halo[c + HH]
          halo[c + (BRICK + 1) * HH] =
            oz + BRICK <= last
              ? data[L.index(ox + lx, oy + ly, oz + BRICK)]
              : halo[c + BRICK * HH]
        }
      }
      let max = 0
      for (let lz = 0; lz < BRICK; lz++) {
        for (let ly = 0; ly < BRICK; ly++) {
          const h = (lz + 1) * HH + (ly + 1) * H + 1
          const dst = base + (lz << 8) + (ly << 4)
          for (let lx = 0; lx < BRICK; lx++) {
            const i = h + lx
            const c = halo[i]
            const sum =
              halo[i - 1] +
              halo[i + 1] +
              halo[i - H] +
              halo[i + H] +
              halo[i - HH] +
              halo[i + HH]
            const out = (c * (1 - m) + sum * sixth) * keep
            tmp[dst + lx] = out
            if (out > max) max = out
          }
        }
      }
      if (max < FIELD_EPS) {
        // Gone quiet. Both buffers are cleared so that skipping it from now on
        // is exact rather than merely close: whichever one the swap makes
        // current, the brick really is empty.
        max = 0
        data.fill(0, base, base + BRICK_CELLS)
        tmp.fill(0, base, base + BRICK_CELLS)
      }
      maxes[slot] = max
    })

    if (obstacles) {
      // Redo the voxels that touch a solid, this time treating the solid face as
      // a no-flux wall: substituting the centre value for a blocked neighbour
      // means nothing crosses it and nothing is lost into it.
      const { mask, boundary, boundaryNb, solid } = obstacles
      for (let b = 0; b < boundary.length; b++) {
        const i = boundary[b]
        const c = data[i]
        const o = b * 6
        let sum = 0
        for (let k = 0; k < 6; k++) {
          const j = boundaryNb[o + k]
          sum += mask[j] ? c : data[j]
        }
        tmp[i] = (c * (1 - m) + sum * sixth) * keep
      }
      for (let b = 0; b < boundary.length; b++) {
        const i = boundary[b]
        const slot = (i / BRICK_CELLS) | 0
        if (tmp[i] > maxes[slot]) maxes[slot] = tmp[i]
      }
      for (let k = 0; k < solid.length; k++) tmp[solid[k]] = 0
    }

    // The zero brick stays zero in whichever buffer is about to become current.
    tmp.fill(0, 0, BRICK_CELLS)
    this.data = tmp
    this.tmp = data
  }

  /**
   * Sum of the field, over the allocated bricks that intersect the region.
   *
   * A brick that holds nothing contributes nothing, and it knows it does, so it
   * is skipped without reading its four thousand cells. The read-out is built
   * five times a second, and most of what it was adding up was zeroes.
   */
  total(region?: FieldRegion): number {
    const d = this.data
    const maxes = this.brickMax
    let s = 0
    this.lattice.forEachBrickIn(region, (slot) => {
      if (maxes[slot] < FIELD_EPS) return
      const base = slot * BRICK_CELLS
      for (let k = 0; k < BRICK_CELLS; k++) s += d[base + k]
    })
    return s
  }

  countAbove(threshold: number, region?: FieldRegion): number {
    const d = this.data
    const maxes = this.brickMax
    let c = 0
    this.lattice.forEachBrickIn(region, (slot) => {
      if (maxes[slot] <= threshold) return
      const base = slot * BRICK_CELLS
      for (let k = 0; k < BRICK_CELLS; k++) if (d[base + k] > threshold) c++
    })
    return c
  }

  /** Zero the allocated bricks in a region, rather than the whole lattice. */
  clearRegion(region: FieldRegion): void {
    const d = this.data
    this.lattice.forEachBrickIn(region, (slot) => {
      d.fill(0, slot * BRICK_CELLS, (slot + 1) * BRICK_CELLS)
    })
  }
}

/** A byte-per-voxel field on the same lattice: the solid, grip and slip masks. */
export class ByteField3D extends BrickStore<Uint8Array> {
  readonly bytesPerCell = 1

  protected make(len: number): Uint8Array {
    return new Uint8Array(len)
  }

  constructor(lattice: Lattice) {
    super(lattice)
    lattice.register(this)
  }

  at(x: number, y: number, z: number): number {
    return this.data[this.lattice.index(x, y, z)]
  }

  /** Does this brick hold anything? Used to decide whether it can be given up. */
  anyNonZero(slot: number): boolean {
    const base = slot * BRICK_CELLS
    const d = this.data
    for (let k = 0; k < BRICK_CELLS; k++) if (d[base + k] !== 0) return true
    return false
  }
}

/** Cached spherical deposition kernels, keyed by radius. */
const kernelCache = new Map<
  string,
  { dx: Int16Array; dy: Int16Array; dz: Int16Array; w: Float32Array }
>()

/**
 * Spread `amount` over a soft sphere of the given radius (in voxels) centred on
 * a point, normalised so nothing is created or lost.
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
  const r = Math.max(0.6, radius)
  const key = r.toFixed(2)
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
  const cx = Math.floor(x)
  const cy = Math.floor(y)
  const cz = Math.floor(z)
  const L = field.lattice
  const last = field.n - 1
  for (let i = 0; i < k.w.length; i++) {
    let vx = cx + k.dx[i]
    let vy = cy + k.dy[i]
    let vz = cz + k.dz[i]
    vx = vx < 0 ? 0 : vx > last ? last : vx
    vy = vy < 0 ? 0 : vy > last ? last : vy
    vz = vz < 0 ? 0 : vz > last ? last : vz
    // The index has to be taken first: allocating a brick can reallocate the
    // backing array, so a reference to it cached outside this loop goes stale.
    const ci = L.cell(vx, vy, vz)
    const v = (field.data[ci] += amount * k.w[i])
    // And the brick has to be marked live, or the integrator will take it for
    // empty ground and never carry this deposit anywhere.
    field.touch(ci, v)
  }
}
