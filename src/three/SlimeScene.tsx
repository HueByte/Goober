import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { colony, useStore } from '../state/store'
import { FOOD_BY_ID } from '../sim/foods'
import { MATERIALS, SOLID_KIND_BY_ID } from '../sim/solids'
import type { FoodShape } from '../sim/types'
import type { SolidInstance } from '../sim/solids'
import { createPointCloud, flushCloud } from './points'
import { getPalette } from './palette'
import { Plasmodium } from './Plasmodium'

/** Advances the simulation and pushes a stats snapshot to the UI a few times a second. */
function SimDriver() {
  const lastPush = useRef(0)
  const frames = useRef(0)
  const fpsClock = useRef(0)
  const fps = useRef(0)

  useFrame((_, delta) => {
    const { paused, speed, refresh } = useStore.getState()
    const dt = Math.min(delta, 0.05)

    frames.current++
    fpsClock.current += dt
    if (fpsClock.current > 0.5) {
      fps.current = frames.current / fpsClock.current
      frames.current = 0
      fpsClock.current = 0
    }

    let substeps = 0
    let stepMs = 0
    if (!paused) {
      const t0 = performance.now()
      substeps = colony.advance(dt, speed).substeps
      stepMs = performance.now() - t0
    }

    lastPush.current += dt
    if (lastPush.current > 0.2) {
      lastPush.current = 0
      refresh({ fps: fps.current, stepMs, substeps })
    }
  })
  return null
}

/** The motes themselves: one point per packet of plasmodium. */
function Motes() {
  const show = useStore((s) => s.showMotes)
  const capacity = useStore((s) => s.params.maxMotes)
  const palette = getPalette(useStore((s) => s.paletteId))
  const cloud = useMemo(
    () =>
      createPointCloud(capacity, {
        opacity: 0.9,
        additive: true,
        depthWrite: false,
        minPixels: 1,
        maxPixels: 4,
      }),
    [capacity],
  )

  const { gl } = useThree()
  useEffect(() => {
    const m = cloud.points.material as THREE.ShaderMaterial
    m.uniforms.uPixelRatio.value = Math.min(gl.getPixelRatio(), 2)
  }, [gl, cloud])

  useEffect(() => {
    return () => {
      cloud.points.geometry.dispose()
      ;(cloud.points.material as THREE.Material).dispose()
    }
  }, [cloud])

  const [mc0, mc1, mc2] = palette.moteCold
  const [mw0, mw1, mw2] = palette.moteWarm
  const [al0, al1, al2] = palette.alarm

  useFrame(() => {
    if (!show) return
    const { position, color, size } = cloud
    const c = colony
    let k = 0
    const max = Math.min(capacity, c.highWater)
    for (let i = 0; i < max; i++) {
      const st = c.state[i]
      if (st === 0) continue
      const o = k * 3
      position[o] = c.px[i]
      position[o + 1] = c.py[i]
      position[o + 2] = c.pz[i]
      if (st === 2) {
        // Sclerotium: dark, dormant amber.
        color[o] = 0.34
        color[o + 1] = 0.17
        color[o + 2] = 0.05
        size[k] = 0.24
      } else {
        const t = c.satiety[i]
        // Exploring tips read cold and cyan; fed, transporting plasmodium is warm.
        // The advancing front reads cold; a fed mote sitting in a working vein
        // goes warm. Both ends come from the chosen scheme.
        // Arousal rides on top: a mote driving at a find burns brighter, one in
        // trouble flashes over to the alarm colour.
        const mood = c.mood[i]
        const fear = mood < 0 ? -mood : 0
        const br = (0.75 + 0.25 * t) * (1 + 0.5 * Math.max(0, mood))
        const r = mc0 + (mw0 - mc0) * t
        const g = mc1 + (mw1 - mc1) * t
        const b2 = mc2 + (mw2 - mc2) * t
        color[o] = (r + (al0 - r) * fear) * br
        color[o + 1] = (g + (al1 - g) * fear) * br
        color[o + 2] = (b2 + (al2 - b2) * fear) * br
        size[k] = (0.26 + Math.min(1, c.biomass[i] / 24) * 0.22) * (1 + 0.35 * Math.abs(mood))
      }
      k++
    }
    // A colony of twenty thousand motes should not paint a solid wall of light:
    // thin them as the population climbs so the advancing front stays readable.
    const crowd = Math.max(0.62, Math.min(1, Math.sqrt(3500 / Math.max(k, 1))))
    const mat = cloud.points.material as THREE.ShaderMaterial
    mat.uniforms.uOpacity.value = 0.95 * crowd
    mat.uniforms.uMax.value = 4 * crowd
    flushCloud(cloud, k)
  })

  return <primitive object={cloud.points} visible={show} />
}

interface SurfaceHandlers {
  onPointerMove: (e: ThreeEvent<PointerEvent>) => void
  onPointerOut: () => void
  onClick: (e: ThreeEvent<MouseEvent>) => void
}

function Solids({ handlers }: { handlers: SurfaceHandlers }) {
  const solids = useStore((s) => s.solids)

  return (
    <group>
      {solids.map((s: SolidInstance) => {
        const mat = MATERIALS[s.material]
        const glassy = s.material === 'glass'
        return (
          <mesh
            key={s.id}
            position={[s.x, s.y, s.z]}
            rotation={[0, s.yaw, 0]}
            castShadow
            receiveShadow
            onPointerMove={handlers.onPointerMove}
            onPointerOut={handlers.onPointerOut}
            onClick={handlers.onClick}
          >
            {s.shape === 'sphere' ? (
              <sphereGeometry args={[s.hx, 32, 24]} />
            ) : s.shape === 'ramp' ? (
              <primitive object={rampGeometry(s.hx, s.hy, s.hz, s.rotated)} attach="geometry" />
            ) : (
              <boxGeometry args={[s.hx * 2, s.hy * 2, s.hz * 2]} />
            )}
            <meshStandardMaterial
              color={mat.color}
              roughness={THREE.MathUtils.clamp(1 - mat.adhesion * 0.55, 0.12, 0.95)}
              metalness={s.material === 'metal' ? 0.75 : 0.04}
              transparent={glassy}
              opacity={glassy ? 0.35 : 1}
            />
          </mesh>
        )
      })}
    </group>
  )
}

const rampCache = new Map<string, THREE.BufferGeometry>()

/**
 * A wedge whose top face rises linearly from the low end to the high end,
 * matching solidContains() in the simulation.
 *
 * Every face is wound counter-clockwise as seen from outside, so the computed
 * normals point outwards. Getting that wrong is why the slope used to render
 * black: its normal was pointing into the ramp.
 */
function rampGeometry(hx: number, hy: number, hz: number, rotated: boolean): THREE.BufferGeometry {
  const key = `${hx}:${hy}:${hz}:${rotated}`
  const hit = rampCache.get(key)
  if (hit) return hit

  // Build it rising along +X, then map to +Z if asked for.
  const along = rotated ? hz : hx
  const cross = rotated ? hx : hz
  const map = (p: [number, number, number]): [number, number, number] =>
    rotated ? [p[2], p[1], p[0]] : p

  const A: [number, number, number] = [-along, -hy, -cross]
  const B: [number, number, number] = [along, -hy, -cross]
  const C: [number, number, number] = [along, -hy, cross]
  const D: [number, number, number] = [-along, -hy, cross]
  const E: [number, number, number] = [along, hy, -cross]
  const F: [number, number, number] = [along, hy, cross]

  const tris: [number, number, number][][] = [
    // underside
    [A, C, D],
    [A, B, C],
    // the slope
    [A, D, F],
    [A, F, E],
    // the tall end
    [B, F, C],
    [B, E, F],
    // the two triangular sides
    [A, E, B],
    [D, C, F],
  ]

  const v: number[] = []
  for (const t of tris) {
    // Mirroring x and z reverses handedness, so the winding has to flip with it.
    const ordered = rotated ? [t[0], t[2], t[1]] : t
    for (const p of ordered) v.push(...map(p))
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
  g.computeVertexNormals()
  rampCache.set(key, g)
  return g
}

/**
 * Physical form per deposit. A flake is a thin lamina, a crystal a faceted
 * prism, a lawn a film spread over the agar. Nothing is a sphere, because
 * nothing on the menu is one.
 */
function foodGeometry(shape: FoodShape, r: number) {
  switch (shape) {
    case 'flake':
      return <boxGeometry args={[r * 2.1, r * 0.34, r * 1.45]} />
    case 'gel':
      return <boxGeometry args={[r * 1.9, r * 0.5, r * 1.9]} />
    case 'lawn':
      return <boxGeometry args={[r * 2.5, r * 0.22, r * 2.5]} />
    case 'chunk':
      return <boxGeometry args={[r * 1.5, r * 1.15, r * 1.25]} />
    case 'drop':
      // A squat octahedron: a bead of liquid sitting on agar, with facets.
      return <octahedronGeometry args={[r * 1.2, 0]} />
    case 'crystal':
      return <octahedronGeometry args={[r * 1.15, 0]} />
    case 'powder':
      // A tipped pile.
      return <tetrahedronGeometry args={[r * 1.45, 0]} />
    case 'slice':
      // Six radial segments: a hexagonal prism, not a disc.
      return <cylinderGeometry args={[r * 1.35, r * 1.35, r * 0.55, 6]} />
    default:
      return <boxGeometry args={[r * 1.7, r * 1.7, r * 1.7]} />
  }
}

/** Non-uniform squash per form, applied on top of the geometry. */
function foodScale(shape: FoodShape): [number, number, number] {
  if (shape === 'drop') return [1, 0.62, 1]
  if (shape === 'crystal') return [0.78, 1.5, 0.78]
  return [1, 1, 1]
}

function FoodMarkers({ handlers }: { handlers: SurfaceHandlers }) {
  const markers = useStore((s) => s.markers)
  const inspected = useStore((s) => s.inspectedInstanceId)
  const inspect = useStore((s) => s.inspect)
  const tool = useStore((s) => s.tool)
  const eraseAt = useStore((s) => s.eraseAt)

  return (
    <group>
      {markers.map((m) => {
        const def = FOOD_BY_ID[m.defId]
        if (!def) return null
        const frac = Math.max(0.1, m.massMg / m.initialMassMg)
        const r = Math.max(0.5, def.radius * Math.cbrt(frac))
        const selected = inspected === m.id
        // A stable pseudo-random yaw per deposit, so a plate of oat flakes does
        // not look like a grid of identical parts.
        const spin = (parseInt(m.id.slice(1), 10) % 12) * 0.5236
        return (
          <group key={m.id} position={[m.x, m.y, m.z]} rotation={[0, spin, 0]}>
            <mesh
              castShadow
              scale={foodScale(def.shape)}
              onPointerMove={handlers.onPointerMove}
              onPointerOut={handlers.onPointerOut}
              onClick={(e) => {
                if (tool === 'erase') {
                  e.stopPropagation()
                  eraseAt(m.x, m.y, m.z)
                  return
                }
                if (tool === 'feed' || tool === 'build' || tool === 'inoculate') {
                  handlers.onClick(e)
                  return
                }
                e.stopPropagation()
                inspect(m.id)
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                inspect(m.id)
              }}
            >
              {foodGeometry(def.shape, r)}
              <meshStandardMaterial
                color={def.color}
                emissive={def.color}
                emissiveIntensity={selected ? 0.55 : 0.2}
                roughness={def.shape === 'crystal' ? 0.18 : 0.55}
                metalness={def.shape === 'crystal' ? 0.15 : 0.04}
                flatShading={def.shape === 'crystal' || def.shape === 'drop' || def.shape === 'powder'}
              />
            </mesh>
            {selected && (
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -r * 0.88, 0]}>
                <ringGeometry args={[r * 1.35, r * 1.5, 40]} />
                <meshBasicMaterial
                  color={def.color}
                  transparent
                  opacity={0.8}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>
            )}
          </group>
        )
      })}
    </group>
  )
}

/** The agar slab. It is solid: everything rests on it, and clicks land on it. */
function Floor({ handlers }: { handlers: SurfaceHandlers }) {
  const grid = useStore((s) => s.params.grid)
  return (
    <mesh
      position={[grid / 2, 0.6, grid / 2]}
      receiveShadow
      onPointerMove={handlers.onPointerMove}
      onPointerOut={handlers.onPointerOut}
      onClick={handlers.onClick}
    >
      <boxGeometry args={[grid, 1.2, grid]} />
      <meshStandardMaterial color="#0c1c26" roughness={0.82} metalness={0.0} />
    </mesh>
  )
}

function Vessel() {
  const grid = useStore((s) => s.params.grid)
  const edges = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(grid, grid, grid)),
    [grid],
  )
  useEffect(() => () => edges.dispose(), [edges])
  return (
    <lineSegments position={[grid / 2, grid / 2, grid / 2]}>
      <primitive object={edges} attach="geometry" />
      <lineBasicMaterial color="#25405a" transparent opacity={0.4} />
    </lineSegments>
  )
}

/**
 * Placement. Clicks land on real geometry - the agar slab, an object or a
 * deposit - so what you point at is where the food goes. In gel mode, where
 * there is no gravity and nothing to rest on, a movable plane is used instead.
 */
function Placement() {
  const grid = useStore((s) => s.params.grid)
  const gravity = useStore((s) => s.env.gravity)
  const height = useStore((s) => s.placementHeight)
  const showPlane = useStore((s) => s.showPlane)
  const tool = useStore((s) => s.tool)
  const selectedFoodId = useStore((s) => s.selectedFoodId)
  const solidKindId = useStore((s) => s.solidKindId)
  const solidMaterial = useStore((s) => s.solidMaterial)
  const solidDims = useStore((s) => s.solidDims)
  const solidRotated = useStore((s) => s.solidRotated)
  const solidClimbable = useStore((s) => s.solidClimbable)
  const solidYaw = useStore((s) => s.solidYaw)
  const wipeRadius = useStore((s) => s.wipeRadius)
  const uiHidden = useStore((s) => s.uiHidden)
  const placeAt = useStore((s) => s.placeAt)
  const ghost = useRef<THREE.Group>(null)
  const down = useRef<{ x: number; y: number } | null>(null)
  const spinning = useRef<number | null>(null)
  const { gl } = useThree()

  useEffect(() => {
    const el = gl.domElement
    const onDown = (e: PointerEvent) => {
      down.current = { x: e.clientX, y: e.clientY }
      if (e.button === 2 && useStore.getState().tool === 'build') {
        spinning.current = e.clientX
      }
    }
    const onMove = (e: PointerEvent) => {
      if (spinning.current === null) return
      // Drag right to spin the object clockwise, about a degree per pixel.
      const dx = e.clientX - spinning.current
      spinning.current = e.clientX
      useStore.getState().rotateSolid(dx * 0.012)
    }
    const onUp = () => {
      spinning.current = null
    }
    const onContext = (e: Event) => {
      if (useStore.getState().tool === 'build') e.preventDefault()
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    el.addEventListener('contextmenu', onContext)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      el.removeEventListener('contextmenu', onContext)
    }
  }, [gl])

  const def = FOOD_BY_ID[selectedFoodId]
  const kind = SOLID_KIND_BY_ID[solidKindId]
  const ghostColor =
    tool === 'inoculate'
      ? '#7ff5c8'
      : tool === 'erase'
        ? '#ff7a7a'
        : tool === 'wipe'
          ? '#ff9f5a'
          : tool === 'build'
            ? solidClimbable
              ? MATERIALS[solidMaterial].color
              : '#ff7a7a'
            : def.color
  const ghostRadius = tool === 'feed' ? def.radius : tool === 'wipe' ? wipeRadius : 1.8
  let gx = solidDims[0] / 2
  const gy = solidDims[1] / 2
  let gz = solidDims[2] / 2
  if (solidRotated && kind.orientable) {
    const t = gx
    gx = gz
    gz = t
  }

  // Sim coordinates from a world-space hit on the offset group.
  const toSim = useCallback(
    (p: THREE.Vector3) => ({ x: p.x + grid / 2, y: p.y + grid / 2, z: p.z + grid / 2 }),
    [grid],
  )

  const handlers: SurfaceHandlers = useMemo(
    () => ({
      onPointerMove: (e: ThreeEvent<PointerEvent>) => {
        if (!ghost.current || useStore.getState().uiHidden) return
        e.stopPropagation()
        const p = toSim(e.point)
        ghost.current.visible = true
        ghost.current.position.set(p.x, p.y + 0.15, p.z)
      },
      onPointerOut: () => {
        if (ghost.current) ghost.current.visible = false
      },
      onClick: (e: ThreeEvent<MouseEvent>) => {
        const start = down.current
        if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) return
        e.stopPropagation()
        const p = toSim(e.point)
        placeAt(p.x, p.y + 0.15, p.z)
      },
    }),
    [toSim, placeAt],
  )

  const gelMode = gravity === 0
  if (uiHidden) {
    // Hands off: the pointer is only for looking around.
    return (
      <>
        <Floor handlers={handlers} />
        <Solids handlers={handlers} />
        <FoodMarkers handlers={handlers} />
      </>
    )
  }

  return (
    <>
      <Floor handlers={handlers} />
      <Solids handlers={handlers} />
      <FoodMarkers handlers={handlers} />

      {gelMode && (
        <mesh
          position={[grid / 2, height, grid / 2]}
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerMove={handlers.onPointerMove}
          onPointerOut={handlers.onPointerOut}
          onClick={handlers.onClick}
        >
          <planeGeometry args={[grid, grid]} />
          <meshBasicMaterial
            visible={showPlane}
            color="#3d6a8a"
            transparent
            opacity={0.06}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}

      <group ref={ghost} visible={false} rotation={[0, tool === 'build' ? solidYaw : 0, 0]}>
        {tool === 'build' ? (
          <mesh position={[0, gy, 0]}>
            <boxGeometry args={[gx * 2, gy * 2, gz * 2]} />
            <meshBasicMaterial color={ghostColor} wireframe transparent opacity={0.8} />
          </mesh>
        ) : (
          <mesh position={[0, ghostRadius * 0.6, 0]} scale={tool === 'feed' ? foodScale(def.shape) : [1, 1, 1]}>
            {tool === 'feed' ? (
              foodGeometry(def.shape, ghostRadius)
            ) : (
              <sphereGeometry args={[ghostRadius, 20, 14]} />
            )}
            <meshBasicMaterial
              color={ghostColor}
              transparent
              opacity={tool === 'wipe' ? 0.12 : 0.28}
              depthWrite={false}
            />
          </mesh>
        )}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
          <ringGeometry args={[ghostRadius * 1.3, ghostRadius * 1.45, 40]} />
          <meshBasicMaterial
            color={ghostColor}
            transparent
            opacity={0.75}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      </group>
    </>
  )
}

export function SlimeScene() {
  const grid = useStore((s) => s.params.grid)
  const illumination = useStore((s) => s.env.illumination)
  const brightness = useStore((s) => s.brightness)
  const building = useStore((s) => s.tool === 'build')

  return (
    <>
      <color attach="background" args={['#04070c']} />
      <fogExp2 attach="fog" args={['#04070c', 0.003]} />
      <SimDriver />

      {/*
        Three-point lighting rather than a single lamp. With one directional
        light every face pointing away from it renders black, which makes a
        vessel full of walls unreadable: you cannot see the far side of anything.
        The key sits above and in front, a cool fill comes from behind, and a
        low rim light picks the far faces out of the background.
      */}
      <ambientLight intensity={0.16 * brightness} color="#8aa8c4" />
      <hemisphereLight args={['#84a8c6', '#16242e', 0.4 * brightness]} />
      {/* The key light is also the lamp the plasmodium is running away from. */}
      <directionalLight
        position={[grid * 0.5, grid * 1.3, grid * 0.6]}
        intensity={(0.9 + illumination * 1.4) * brightness}
      />
      <directionalLight
        position={[-grid * 0.8, grid * 0.6, -grid * 0.7]}
        intensity={0.42 * brightness}
        color="#9dc0e2"
      />
      <directionalLight
        position={[grid * 0.3, grid * 0.15, -grid * 1.0]}
        intensity={0.3 * brightness}
        color="#b6d4ee"
      />
      <group position={[-grid / 2, -grid / 2, -grid / 2]}>
        <Vessel />
        <Placement />
        <Plasmodium />
        <Motes />
      </group>
      <OrbitControls
        makeDefault
        enableDamping
        // While building, the right button spins the object instead of panning.
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: building ? (-1 as unknown as THREE.MOUSE) : THREE.MOUSE.PAN,
        }}
        dampingFactor={0.08}
        minDistance={grid * 0.25}
        maxDistance={grid * 4}
        target={[0, -grid * 0.3, 0]}
      />
    </>
  )
}
