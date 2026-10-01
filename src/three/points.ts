import * as THREE from 'three'

export interface PointLayerOptions {
  /** Overall alpha of the layer. */
  opacity: number
  /** Additive layers glow and never occlude; normal layers read as solid matter. */
  additive?: boolean
  /** Solid layers write depth, so the structure occludes itself properly. */
  depthWrite?: boolean
  /** Clamp in device pixels, so points stay crisp instead of turning into blobs. */
  minPixels?: number
  maxPixels?: number
}

/**
 * Crisp square points with per-point size and colour.
 *
 * Deliberately square and hard-edged rather than a soft round sprite: a dense
 * cloud of small squares reads as fine-grained matter, where soft sprites just
 * smear into fog.
 */
export function createPointsMaterial(o: PointLayerOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uScale: { value: 620 },
      uOpacity: { value: o.opacity },
      uMin: { value: o.minPixels ?? 1 },
      uMax: { value: o.maxPixels ?? 6 },
      uPixelRatio: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      uniform float uScale;
      uniform float uMin;
      uniform float uMax;
      uniform float uPixelRatio;
      varying vec3 vColor;
      void main() {
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float s = aSize * uScale / max(0.001, -mv.z);
        gl_PointSize = clamp(s, uMin, uMax) * uPixelRatio;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec3 vColor;
      void main() {
        gl_FragColor = vec4(vColor, uOpacity);
      }
    `,
    transparent: true,
    depthWrite: o.depthWrite ?? false,
    depthTest: true,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  })
}

export interface PointCloud {
  points: THREE.Points
  position: Float32Array
  color: Float32Array
  size: Float32Array
}

/** Allocate a points object with room for `capacity` vertices. */
export function createPointCloud(capacity: number, options: PointLayerOptions): PointCloud {
  const position = new Float32Array(capacity * 3)
  const color = new Float32Array(capacity * 3)
  const size = new Float32Array(capacity)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(color, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
  geometry.setDrawRange(0, 0)
  // The sim keeps everything inside the vessel, so a fixed sphere is safe and
  // saves recomputing bounds every frame.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4)
  const points = new THREE.Points(geometry, createPointsMaterial(options))
  points.frustumCulled = false
  return { points, position, color, size }
}

export function flushCloud(cloud: PointCloud, count: number): void {
  const g = cloud.points.geometry
  g.setDrawRange(0, count)
  ;(g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
  ;(g.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true
  ;(g.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true
}

/** Deterministic hash, for stable per-point jitter and brightness variation. */
export function hash(i: number): number {
  let h = Math.imul(i ^ (i >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}
