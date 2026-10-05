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

/** How strongly a millimetre of solid attenuates anything passing through it. */
const OCCLUSION = 1.6

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
   * Recruitment.
   *
   * The one thing the swarm had no way of doing was telling each other
   * anything. A nucleus that found food grew and divided where it stood, and
   * the rest of the organism, a few centimetres away, had no idea - so a find
   * produced a colony on the food instead of the body moving onto it.
   *
   * A plasmodium does have a way: feeding changes the contraction rhythm, and
   * the phase wave propagates through the cytoplasm far faster than any
   * molecule diffuses, which is what redirects streaming towards a stimulated
   * region. This is that signal. It is emitted by whatever is actually eating,
   * it travels much further and faster than the nutrient plume it advertises,
   * and every nucleus can read it - so the find is the organism's, not the
   * finder's.
   *
   * It lives on this coarse lattice deliberately. A recruitment signal only has
   * to say which way, not which voxel, and at five millimetres a cell it costs
   * a few thousand operations a minute instead of a few million.
   */
  recruit: Float32Array
  /**
   * How much of each cell is solid, 0..1.
   *
   * Chemistry does not go through walls. A quinine crystal on the far side of a
   * barrier was repelling the colony through it, a volatile was advertising
   * through it, and the recruitment signal - which travels through the
   * cytoplasm, and so cannot leave the organism at all - was crossing to places
   * the organism could not. This is what every one of those is attenuated by.
   */
  solidFrac: Float32Array
  private anySolid = false
  /**
   * Whether anything on the plate contributes to each field at all. These
   * lattices are far coarser than the nutrient ones - the chemistry they carry
   * changes over millimetres, not micrometres - so the empty case is worth
   * short-circuiting, and the non-empty case is worth interpolating.
   */
  private anyRepel = false
  private anyLure = false
  private anyNarcotic = false
  private recruitTmp: Float32Array
  private anyRecruit = false

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
    this.recruit = new Float32Array(len)
    this.recruitTmp = new Float32Array(len)
    this.solidFrac = new Float32Array(len)
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

  recruitAt(x: number, y: number, z: number): number {
    return this.anyRecruit ? this.sample(this.recruit, x, y, z) : 0
  }

  /**
   * Take the vessel's obstacles at this lattice's resolution.
   *
   * `sample` answers whether a point in world space is inside something solid.
   * Each cell is sampled on a 3x3x3 grid, which at five millimetres a cell is a
   * fair estimate of how much of it is wall and costs a couple of hundred
   * thousand tests - only when the objects change.
   */
  setObstacles(sample: ((x: number, y: number, z: number) => boolean) | null): void {
    const n = this.n
    const cell = this.worldSize / n
    this.solidFrac.fill(0)
    this.anySolid = false
    if (!sample) return
    for (let iz = 0; iz < n; iz++) {
      for (let iy = 0; iy < n; iy++) {
        const row = n * (iy + n * iz)
        for (let ix = 0; ix < n; ix++) {
          let hits = 0
          for (let c = 0; c < 3; c++) {
            const wz = (iz + (c + 0.5) / 3) * cell
            for (let b = 0; b < 3; b++) {
              const wy = (iy + (b + 0.5) / 3) * cell
              for (let a = 0; a < 3; a++) {
                if (sample((ix + (a + 0.5) / 3) * cell, wy, wz)) hits++
              }
            }
          }
          if (hits > 0) {
            this.solidFrac[row + ix] = hits / 27
            this.anySolid = true
          }
        }
      }
    }
  }

  /**
   * How much of a signal survives the trip from a deposit to a point.
   *
   * A line of sight through the coarse obstacle map, attenuated by how much wall
   * it passes through rather than switched off by it - a chemical does reach
   * round a barrier, just very much less of it, and a long enough wall casts a
   * real shadow because the path through it is longer.
   */
  private transmission(
    fx: number,
    fy: number,
    fz: number,
    tx: number,
    ty: number,
    tz: number,
  ): number {
    if (!this.anySolid) return 1
    const dx = tx - fx
    const dy = ty - fy
    const dz = tz - fz
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
    const cell = this.worldSize / this.n
    const steps = Math.min(16, Math.max(2, Math.ceil(dist / cell)))
    let blocked = 0
    for (let k = 1; k < steps; k++) {
      const t = k / steps
      blocked += this.solidFrac[this.idx(fx + dx * t, fy + dy * t, fz + dz * t)]
    }
    if (blocked <= 0) return 1
    // Scaled by how long each step was, so a thick wall blocks more than a thin
    // one and the answer does not depend on how finely the ray was sampled.
    return Math.exp((-OCCLUSION * blocked * dist) / steps)
  }

  /** A nucleus that is taking up substrate tells the rest of the organism. */
  addRecruit(x: number, y: number, z: number, amount: number): void {
    if (amount <= 0) return
    this.recruit[this.idx(x, y, z)] += amount
    this.anyRecruit = true
  }

  /**
   * Spread the signal and let it fade. Several passes per call, because the
   * point of it is to arrive somewhere the food itself never will - and on a
   * lattice this coarse, several passes are still almost free.
   */
  stepRecruit(decay: number, passes = 3, mix = 0.7): void {
    if (!this.anyRecruit) return
    const n = this.n
    const nn = n * n
    const keep = 1 - decay
    let src = this.recruit
    let dst = this.recruitTmp
    const solid = this.solidFrac
    const sixth = mix / 6
    for (let p = 0; p < passes; p++) {
      for (let z = 0; z < n; z++) {
        for (let y = 0; y < n; y++) {
          const row = nn * z + n * y
          for (let x = 0; x < n; x++) {
            const i = row + x
            const c = src[i]
            // The vessel wall reflects: a signal does not leave the organism.
            // The signal travels through the cytoplasm, so it cannot pass
            // through a wall at all - what is solid simply does not conduct.
            const here = 1 - solid[i]
            if (here <= 0.01) {
              dst[i] = 0
              continue
            }
            let sum = 0
            let open = 0
            for (let d = 0; d < 6; d++) {
              const j =
                d === 0
                  ? x > 0
                    ? i - 1
                    : i
                  : d === 1
                    ? x < n - 1
                      ? i + 1
                      : i
                    : d === 2
                      ? y > 0
                        ? i - n
                        : i
                      : d === 3
                        ? y < n - 1
                          ? i + n
                          : i
                        : d === 4
                          ? z > 0
                            ? i - nn
                            : i
                          : z < n - 1
                            ? i + nn
                            : i
              const pass = 1 - solid[j]
              sum += src[j] * pass
              open += pass
            }
            // Whatever cannot flow outwards stays where it is, so nothing is
            // lost into a wall.
            dst[i] = c * (1 - (mix * open) / 6) + sum * sixth
          }
        }
      }
      const swap = src
      src = dst
      dst = swap
    }
    let peak = 0
    for (let i = 0; i < src.length; i++) {
      const v = (src[i] *= keep)
      if (v > peak) peak = v
    }
    this.recruit = src
    this.recruitTmp = dst
    this.anyRecruit = peak > 1e-6
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
              const inRepel =
                (f.repellency > 0 || f.narcotic > 0) && d2 < f.repelReach * f.repelReach
              const inLure = f.lure > 0 && d2 < f.lureReach * f.lureReach
              const inReach = d2 <= f.reach * f.reach
              if (!inRepel && !inLure && !inReach) continue
              // What a wall between here and the deposit leaves of it. Worked
              // out once per deposit per cell, and only for the cells that were
              // going to be affected at all.
              const t = this.transmission(f.x, f.y, f.z, wx, wy, wz)
              if (t < 1e-3) continue
              if (inRepel) {
                const g = f.strength * Math.exp(-d2 / f.repelSigma2) * t
                rep += g * f.repellency
                nar += g * f.narcotic
              }
              if (inLure) {
                lur += f.strength * f.lure * Math.exp(-d2 / f.lureSigma2) * t
              }
              if (!inReach) continue
              const w = f.strength * Math.exp(-d2 / f.sigma2) * t
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
