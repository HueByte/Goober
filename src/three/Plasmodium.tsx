import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type * as THREE from 'three'
import { colony, useStore } from '../state/store'
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
        minPixels: 1.4,
        maxPixels: 6,
      }),
    [],
  )
  const glow = useMemo(
    () =>
      createPointCloud(GLOW_BUDGET, {
        opacity: 0.55,
        additive: true,
        depthWrite: false,
        minPixels: 1.5,
        maxPixels: 9,
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
    const n = colony.n
    const nn = n * n
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
      let k = 0
      let g = 0
      for (let z = r.z0; z <= r.z1; z++) {
        const zo = nn * z
        for (let y = r.y0; y <= r.y1; y++) {
          const row = zo + n * y
          for (let x = r.x0; x <= r.x1; x++) {
            const i = row + x
            const v = data[i]
            if (v <= thr) continue
            // How established this stretch is, 0..1 on a log scale. Brightness
            // and density both key off it, so a walked path reads as a cool
            // slate thread and a working vein as hot gold cord.
            const q = Math.min(1, Math.log1p(v / VEIN_FLOOR) / LOG_NORM)
            const q2 = q * q
            const many = 1 + ((q * 6) | 0)
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
              size[k] = 0.3 + q * 0.8
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
                gs[g] = 0.5 + gq * 1.5
                g++
              }
            }
            if (k >= VEIN_BUDGET) break
          }
          if (k >= VEIN_BUDGET) break
        }
        if (k >= VEIN_BUDGET) break
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
      for (let z = r.z0; z <= r.z1; z++) {
        const zo = nn * z
        for (let y = r.y0; y <= r.y1; y++) {
          const row = zo + n * y
          for (let x = r.x0; x <= r.x1; x++) {
            const i = row + x
            const v = data[i]
            if (v <= thr) continue
            if (k >= SLIME_BUDGET) break
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
          if (k >= SLIME_BUDGET) break
        }
        if (k >= SLIME_BUDGET) break
      }
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
