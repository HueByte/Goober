import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type * as THREE from 'three'
import { colony, useStore } from '../state/store'
import { BRICK } from '../sim/field'
import { createPointCloud, flushCloud, hash } from './points'
import { getPalette } from './palette'

/**
 * The colony, drawn as point clouds.
 *
 * Both layers are sampled straight out of the simulation's own fields. A voxel
 * does not contribute one point: it contributes a number of points proportional
 * to how much is in it, scattered inside the voxel, so a thick transport vein
 * becomes a dense crisp cord and a thin exploratory sheet stays a faint dust.
 * That is what keeps it reading as matter rather than as a lattice.
 *
 *  - veins: the transport tubes, solid and warm. These are the routes the colony
 *    has committed to and kept.
 *  - slime: everywhere it has searched, dim and cool, behind the veins.
 */

const BRICK_CELLS = BRICK ** 3

const VEIN_BUDGET = 190_000
const SLIME_BUDGET = 150_000
/** Extra additive points laid over the busiest routes, to make them glow. */
const GLOW_BUDGET = 70_000
/** Where on the scale below a route starts to glow. */
const GLOW_FROM = 0.55
/**
 * Tube thickness spans about 40:1 between a route being walked and a site being
 * fed on, and a linear scale crushes the whole travelling network to nothing:
 * measured, 86% of the tube voxels in a mature colony sit in the bottom sixth of
 * the range. So the scale is logarithmic, which is what makes the paths between
 * the food visible at all.
 */
const VEIN_FLOOR = 3
const VEIN_TOP = 420
const LOG_NORM = Math.log1p(VEIN_TOP / VEIN_FLOOR)
/** Log-spaced bins used to auto-expose the tube network. */
const BINS = 48
const BIN_SCALE = BINS / LOG_NORM
const SLIME_REF = 24
/** Tube thickness that counts as fully established, for brightness and density. */

export function Plasmodium() {
  const showSlime = useStore((s) => s.showNetwork)
  const showVeins = useStore((s) => s.showVeins)
  const palette = getPalette(useStore((s) => s.paletteId))
  const { gl } = useThree()

  const veins = useMemo(
    () =>
      createPointCloud(VEIN_BUDGET, {
        opacity: 1,
        additive: false,
        depthWrite: true,
        minPixels: 1.1,
        maxPixels: 3.4,
      }),
    [],
  )
  const glow = useMemo(
    () =>
      createPointCloud(GLOW_BUDGET, {
        opacity: 0.55,
        additive: true,
        depthWrite: false,
        minPixels: 1.2,
        maxPixels: 5,
      }),
    [],
  )
  const slime = useMemo(
    () =>
      createPointCloud(SLIME_BUDGET, {
        opacity: 0.5,
        additive: true,
        depthWrite: false,
        minPixels: 1,
        maxPixels: 3.2,
      }),
    [],
  )

  useEffect(() => {
    const dpr = Math.min(gl.getPixelRatio(), 2)
    ;(veins.points.material as THREE.ShaderMaterial).uniforms.uPixelRatio.value = dpr
    ;(glow.points.material as THREE.ShaderMaterial).uniforms.uPixelRatio.value = dpr
    ;(slime.points.material as THREE.ShaderMaterial).uniforms.uPixelRatio.value = dpr
  }, [gl, veins, glow, slime])

  useEffect(() => {
    return () => {
      for (const c of [veins, glow, slime]) {
        c.points.geometry.dispose()
        ;(c.points.material as THREE.Material).dispose()
      }
    }
  }, [veins, glow, slime])

  const veinThreshold = useRef(2)
  /**
   * Auto-exposure. A fixed colour ramp cannot serve both a young colony, where
   * every tube is thin and needs lifting, and a mature one covering the plate,
   * where the same mapping turns everything into mush. So the ramp is fitted to
   * the network that is actually there: a histogram of the last rebuild gives
   * the window between the thinnest strands and the heaviest few percent, and
   * the colour runs across that. Quiet ground stays dark whatever the colony is
   * doing, and the working routes always read.
   */
  const expose = useRef({ lo: 0.08, hi: 0.75 })
  const histogram = useRef(new Int32Array(BINS))
  const slimeThreshold = useRef(1.2)
  const tick = useRef(0)

  const [cool0, cool1, cool2] = palette.coolTube
  const [hot0, hot1, hot2] = palette.hotTube
  const [glow0, glow1, glow2] = palette.glow
  const [sl0, sl1, sl2] = palette.slime
  const [sw0, sw1, sw2] = palette.slimeWarm

  useFrame(() => {
    // Nothing moves while paused, so there is nothing to rebuild.
    if (useStore.getState().paused) return
    tick.current++
    // Everything outside the active region is provably empty: never scan it.
    const r = colony.activeRegion

    // --- transport tubes -------------------------------------------------
    if (showVeins && tick.current % 3 === 0) {
      const data = colony.vein.data
      const { position, color, size } = veins
      const gp = glow.position
      const gc = glow.color
      const gs = glow.size
      const thr = veinThreshold.current
      const hist = histogram.current
      hist.fill(0)
      const { lo, hi } = expose.current
      const span = Math.max(0.05, hi - lo)
      let k = 0
      let g = 0
      // The lattice is sparse, so the only way through it is brick by brick.
      // That is also the cheap way: an empty vessel has no bricks to visit,
      // however large it is.
      colony.lattice.forEachBrickIn(r, (slot, bx, by, bz) => {
        if (k >= VEIN_BUDGET) return
        const base = slot * BRICK_CELLS
        for (let lz = 0; lz < BRICK; lz++) {
          const z = bz * BRICK + lz
          for (let ly = 0; ly < BRICK; ly++) {
            const y = by * BRICK + ly
            const rowBase = base + (lz << 8) + (ly << 4)
            for (let lx = 0; lx < BRICK; lx++) {
              const x = bx * BRICK + lx
              const i = rowBase + lx
              const v = data[i]
              if (v <= thr) continue
            // Where this stretch sits on the log scale of tube thickness...
            const raw = Math.min(1, Math.log1p(v / VEIN_FLOOR) / LOG_NORM)
            hist[Math.min(BINS - 1, (raw * BINS) | 0)]++
            // ...and where that falls inside the exposure window.
            const q = raw <= lo ? 0 : raw >= hi ? 1 : (raw - lo) / span
            const q2 = q * q
            // Points per voxel. A vein is a cord, not a bank of fog, so the
            // density rises with thickness but far less steeply than it used to:
            // a wide front should read as a wide front, not as a solid field.
            const many = 1 + ((q * 3) | 0)
            for (let m = 0; m < many; m++) {
              if (k >= VEIN_BUDGET) break
              const h1 = hash(i * 7 + m * 131)
              const h2 = hash(i * 13 + m * 71 + 5)
              const h3 = hash(i * 29 + m * 197 + 11)
              const o = k * 3
              position[o] = x + h1
              position[o + 1] = y + h2
              position[o + 2] = z + h3
              // Two readings of the same structure. A searching strand sits at
              // the cool end of the ramp: clearly there, clearly not carrying
              // anything. A working vein is at the hot end. The hue does the
              // separating, so the quiet parts stay legible rather than being
              // dimmed into the background.
              const b = 0.8 + 0.2 * hash(i + m)
              // Fade out across the last few units above the cut-off, so a tube
              // being reabsorbed dims away over hours instead of blinking out of
              // existence the moment it drops below the threshold.
              const fade = v > thr + 5 ? 1 : (v - thr) / 5
              const a = (0.38 + 0.62 * q) * b * fade
              color[o] = (cool0 + (hot0 - cool0) * q2) * a
              color[o + 1] = (cool1 + (hot1 - cool1) * q2) * a
              color[o + 2] = (cool2 + (hot2 - cool2) * q2) * a
              size[k] = 0.24 + q * 0.46
              k++

              // A working route also gets an additive halo, so the paths the
              // colony is actually using read at a glance across the vessel.
              if (q > GLOW_FROM && g < GLOW_BUDGET && m === 0) {
                const gq = (q - GLOW_FROM) / (1 - GLOW_FROM)
                const go = g * 3
                gp[go] = position[o]
                gp[go + 1] = position[o + 1]
                gp[go + 2] = position[o + 2]
                gc[go] = glow0 * (0.55 + 0.45 * gq)
                gc[go + 1] = glow1 * (0.55 + 0.45 * gq)
                gc[go + 2] = glow2 * (0.55 + 0.45 * gq)
                gs[g] = 0.4 + gq * 0.9
                g++
              }
            }
              if (k >= VEIN_BUDGET) return
            }
          }
        }
      })
      // Fit the window for the next rebuild. The bottom of it sits below the
      // bulk of the network rather than in the middle of it: most of what the
      // colony has is thin exploratory strand, and that strand is the route it
      // took, so it has to read as a thread rather than be clipped to black.
      // The top is the heaviest two percent. Eased, so the view does not
      // flicker as the colony works.
      let total = 0
      for (let bi = 0; bi < BINS; bi++) total += hist[bi]
      if (total > 200) {
        const loTarget = total * 0.12
        const hiTarget = total * 0.98
        let acc = 0
        let loBin = 0
        let hiBin = BINS - 1
        for (let bi = 0; bi < BINS; bi++) {
          acc += hist[bi]
          if (acc < loTarget) loBin = bi
          if (acc < hiTarget) hiBin = bi
        }
        const wantLo = loBin / BIN_SCALE / LOG_NORM
        const wantHi = Math.max(wantLo + 0.1, (hiBin + 1) / BIN_SCALE / LOG_NORM)
        expose.current.lo += (wantLo - expose.current.lo) * 0.15
        expose.current.hi += (wantHi - expose.current.hi) * 0.15
      }
      if (k >= VEIN_BUDGET) veinThreshold.current = thr * 1.18 + 0.4
      else if (k < VEIN_BUDGET * 0.6 && thr > 2) veinThreshold.current = Math.max(2, thr * 0.93)
      flushCloud(veins, k)
      flushCloud(glow, g)
    }

    // --- deposited slime -------------------------------------------------
    if (showSlime && tick.current % 3 === 1) {
      const data = colony.trail.data
      const { position, color, size } = slime
      const thr = slimeThreshold.current
      let k = 0
      colony.lattice.forEachBrickIn(r, (slot, bx, by, bz) => {
        if (k >= SLIME_BUDGET) return
        const base = slot * BRICK_CELLS
        for (let lz = 0; lz < BRICK; lz++) {
          const z = bz * BRICK + lz
          for (let ly = 0; ly < BRICK; ly++) {
            const y = by * BRICK + ly
            const rowBase = base + (lz << 8) + (ly << 4)
            for (let lx = 0; lx < BRICK; lx++) {
              const x = bx * BRICK + lx
              const i = rowBase + lx
              const v = data[i]
              if (v <= thr) continue
              if (k >= SLIME_BUDGET) return
            const t = v / (v + SLIME_REF)
            const o = k * 3
            position[o] = x + hash(i * 3)
            position[o + 1] = y + hash(i * 17 + 1)
            position[o + 2] = z + hash(i * 37 + 2)
            // Cool where it merely passed, warmer where it lingered.
            color[o] = sl0 + (sw0 - sl0) * t
            color[o + 1] = sl1 + (sw1 - sl1) * t
            color[o + 2] = sl2 + (sw2 - sl2) * t
              size[k] = 0.26 + t * 0.3
              k++
            }
          }
        }
      })
      if (k >= SLIME_BUDGET) slimeThreshold.current = thr * 1.2 + 0.5
      else if (k < SLIME_BUDGET * 0.6 && thr > 1.2) slimeThreshold.current = Math.max(1.2, thr * 0.92)
      // Fade the halo as it gets crowded: a big colony should still be readable.
      const mat = slime.points.material as THREE.ShaderMaterial
      mat.uniforms.uOpacity.value = Math.max(0.18, Math.min(0.5, 0.5 * Math.sqrt(9000 / Math.max(k, 1))))
      flushCloud(slime, k)
    }
  })

  return (
    <>
      <primitive object={slime.points} visible={showSlime} />
      <primitive object={veins.points} visible={showVeins} />
      <primitive object={glow.points} visible={showVeins} />
    </>
  )
}
