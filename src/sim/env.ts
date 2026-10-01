/**
 * Coarse environmental chemistry grid: pH, osmolarity, toxin load and the
 * resulting chemorepulsion.
 *
 * These quantities change slowly and act over long distances compared with the
 * nutrient plumes, so they live on a much coarser lattice that is rebuilt every
 * simulated minute rather than integrated every step.
 */
import { FOOD_BY_ID, analyse, dispersedOsmolarity, foodMassMg } from './foods'
import { clamp } from './biology'
import type { EnvParams, FoodInstance } from './types'

export interface EnvSample {
  ph: number
  osmolarity: number
  toxin: number
  repel: number
  /** Volatile attractant: smelt at a distance, and no guarantee of a meal. */
  lure: number
  /** Suppression of the contraction rhythm, 0..1-ish. */
  narcotic: number
}

export class EnvGrid {
  readonly n: number
  readonly worldSize: number
  private readonly toVoxel: number
  ph: Float32Array
  osmo: Float32Array
  toxin: Float32Array
  repel: Float32Array
  lure: Float32Array
  narcotic: Float32Array
  /**
   * Whether anything on the plate contributes to each field at all. These
   * lattices are far coarser than the nutrient ones - the chemistry they carry
   * changes over millimetres, not micrometres - so the empty case is worth
   * short-circuiting, and the non-empty case is worth interpolating.
   */
  private anyRepel = false
  private anyLure = false
  private anyNarcotic = false

  constructor(n: number, worldSize: number) {
    this.n = n
    this.worldSize = worldSize
    this.toVoxel = n / worldSize
    const len = n * n * n
    this.ph = new Float32Array(len)
    this.osmo = new Float32Array(len)
    this.toxin = new Float32Array(len)
    this.repel = new Float32Array(len)
    this.lure = new Float32Array(len)
    this.narcotic = new Float32Array(len)
  }

  private idx(x: number, y: number, z: number): number {
    const n = this.n
    const last = n - 1
    let ix = Math.floor(x * this.toVoxel)
    let iy = Math.floor(y * this.toVoxel)
    let iz = Math.floor(z * this.toVoxel)
    ix = ix < 0 ? 0 : ix > last ? last : ix
    iy = iy < 0 ? 0 : iy > last ? last : iy
    iz = iz < 0 ? 0 : iz > last ? last : iz
    return ix + n * (iy + n * iz)
  }

  phAt(x: number, y: number, z: number): number {
    return this.ph[this.idx(x, y, z)]
  }

  osmoAt(x: number, y: number, z: number): number {
    return this.osmo[this.idx(x, y, z)]
  }

  toxinAt(x: number, y: number, z: number): number {
    return this.toxin[this.idx(x, y, z)]
  }

  /**
   * Trilinear sample.
   *
   * This matters more than it looks. A mote's sensors sit 1.7 mm apart and a
   * cell of this lattice is nearly 5 mm across, so reading the nearest cell
   * gives every sensor the same number and the gradient the organism is
   * supposed to be following disappears entirely. Interpolating recovers it:
   * the field is smooth to begin with, and this is what makes it smooth to
   * something standing inside one cell of it.
   */
  private sample(f: Float32Array, x: number, y: number, z: number): number {
    const n = this.n
    const last = n - 1
    let fx = x * this.toVoxel - 0.5
    let fy = y * this.toVoxel - 0.5
    let fz = z * this.toVoxel - 0.5
    fx = fx < 0 ? 0 : fx > last ? last : fx
    fy = fy < 0 ? 0 : fy > last ? last : fy
    fz = fz < 0 ? 0 : fz > last ? last : fz
    const ix = fx | 0
    const iy = fy | 0
    const iz = fz | 0
    const jx = ix < last ? ix + 1 : ix
    const jy = iy < last ? iy + 1 : iy
    const jz = iz < last ? iz + 1 : iz
    const tx = fx - ix
    const ty = fy - iy
    const tz = fz - iz
    const r0 = n * (iy + n * iz)
    const r1 = n * (jy + n * iz)
    const r2 = n * (iy + n * jz)
    const r3 = n * (jy + n * jz)
    const c00 = f[r0 + ix] + (f[r0 + jx] - f[r0 + ix]) * tx
    const c10 = f[r1 + ix] + (f[r1 + jx] - f[r1 + ix]) * tx
    const c01 = f[r2 + ix] + (f[r2 + jx] - f[r2 + ix]) * tx
    const c11 = f[r3 + ix] + (f[r3 + jx] - f[r3 + ix]) * tx
    const c0 = c00 + (c10 - c00) * ty
    const c1 = c01 + (c11 - c01) * ty
    return c0 + (c1 - c0) * tz
  }

  repelAt(x: number, y: number, z: number): number {
    return this.anyRepel ? this.sample(this.repel, x, y, z) : 0
  }

  lureAt(x: number, y: number, z: number): number {
    return this.anyLure ? this.sample(this.lure, x, y, z) : 0
  }

  narcoticAt(x: number, y: number, z: number): number {
    return this.anyNarcotic ? this.sample(this.narcotic, x, y, z) : 0
  }

  sampleInto(x: number, y: number, z: number, out: EnvSample): EnvSample {
    const i = this.idx(x, y, z)
    out.ph = this.ph[i]
    out.osmolarity = this.osmo[i]
    out.toxin = this.toxin[i]
    out.repel = this.repel[i]
    out.lure = this.lure[i]
    out.narcotic = this.narcotic[i]
    return out
  }

  rebuild(foods: FoodInstance[], env: EnvParams): void {
    const n = this.n
    const cell = this.worldSize / n
    this.ph.fill(env.substratePh)
    this.osmo.fill(env.substrateOsmolarity)
    this.toxin.fill(0)
    this.repel.fill(0)
    this.lure.fill(0)
    this.narcotic.fill(0)

    // Pre-resolve the per-food chemistry so the inner loop is pure arithmetic.
    const src = foods
      .map((f) => {
        const def = FOOD_BY_ID[f.defId]
        const a = analyse(def)
        const mass = foodMassMg(f)
        const frac = clamp(mass / f.initialMassMg, 0, 1)
        if (frac <= 0.001) return null
        const radius = Math.max(1, def.radius * Math.cbrt(frac))
        const repellency = def.toxins.reduce((s, t) => s + t.repellency, 0)
        const narcotic = def.toxins.reduce((s, t) => s + (t.narcosis ?? 0), 0)
        // Volatiles are reported per 100 g; a few hundred mg is a food that can
        // be smelt, a few thousand is one that can be smelt across the vessel.
        const lure = (def.volatiles ?? 0) / 1000
        return {
          x: f.x,
          y: f.y,
          z: f.z,
          // Influence falls off over roughly twice the deposit radius.
          sigma2: 2 * (radius * 1.25) ** 2,
          /**
           * Repellents carry much further than they act. A crystal of quinine or
           * salt is detectable - and avoided - long before it is close enough to
           * do harm, which is the whole point of chemorepulsion.
           */
          repelSigma2: 2 * (radius * 4.5) ** 2,
          repelReach: radius * 12,
          /**
           * Vapour carries much further than anything dissolved, and is not held
           * up by the agar, so the attractant plume is by far the widest field
           * here - tens of millimetres, not the two or three a solute manages.
           * That is the whole point of a volatile: it advertises.
           */
          lureSigma2: 2 * (radius * 4 + 22) ** 2,
          lureReach: radius * 4 + 70,
          lure,
          narcotic,
          // A partly consumed deposit is also a partly diluted one.
          strength: frac,
          ph: def.ph,
          // What the deposit's solute actually comes to once dispersed into the
          // agar around it, not the concentration inside the food itself.
          osmo: dispersedOsmolarity(def, mass),
          toxin: a.toxinLoad,
          repellency,
          reach: radius * 3.5,
        }
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)

    this.anyRepel = src.some((f) => f.repellency > 0) || env.substrateOsmolarity > 300
    this.anyLure = src.some((f) => f.lure > 0)
    this.anyNarcotic = src.some((f) => f.narcotic > 0)

    if (src.length > 0) {
      for (let iz = 0; iz < n; iz++) {
        const wz = (iz + 0.5) * cell
        for (let iy = 0; iy < n; iy++) {
          const wy = (iy + 0.5) * cell
          const rowBase = n * (iy + n * iz)
          for (let ix = 0; ix < n; ix++) {
            const wx = (ix + 0.5) * cell
            const i = rowBase + ix
            let wSum = 1 // the blank substrate always has weight 1
            let phAcc = env.substratePh
            // Solute adds up; pH does not, so it is a weighted blend instead.
            let osmoAcc = env.substrateOsmolarity
            let tox = 0
            let rep = 0
            let lur = 0
            let nar = 0
            for (let s = 0; s < src.length; s++) {
              const f = src[s]
              const dx = wx - f.x
              const dy = wy - f.y
              const dz = wz - f.z
              const d2 = dx * dx + dy * dy + dz * dz
              if (f.repellency > 0 && d2 < f.repelReach * f.repelReach) {
                rep += f.strength * f.repellency * Math.exp(-d2 / f.repelSigma2)
              }
              if (f.lure > 0 && d2 < f.lureReach * f.lureReach) {
                lur += f.strength * f.lure * Math.exp(-d2 / f.lureSigma2)
              }
              if (f.narcotic > 0 && d2 < f.repelReach * f.repelReach) {
                nar += f.strength * f.narcotic * Math.exp(-d2 / f.repelSigma2)
              }
              if (d2 > f.reach * f.reach) continue
              const w = f.strength * Math.exp(-d2 / f.sigma2)
              if (w < 1e-4) continue
              wSum += w
              phAcc += w * f.ph
              osmoAcc += w * f.osmo
              tox += w * f.toxin
            }
            const osmo = Math.min(8000, osmoAcc)
            this.ph[i] = phAcc / wSum
            this.osmo[i] = osmo
            this.toxin[i] = tox
            this.lure[i] = lur
            this.narcotic[i] = nar
            // Hypertonic ground is avoided in its own right, independently of
            // whether anything in it is chemically toxic.
            this.repel[i] = rep + clamp((osmo - 300) / 700, 0, 1.6)
          }
        }
      }
    } else {
      const baseRepel = clamp((env.substrateOsmolarity - 300) / 700, 0, 1.6)
      if (baseRepel > 0) this.repel.fill(baseRepel)
      this.anyRepel = baseRepel > 0
    }
  }
}
