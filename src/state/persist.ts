import type { ColonySnapshot } from '../sim/colony'
import type { Colony } from '../sim/colony'

/**
 * Scene persistence.
 *
 * A reload should not cost you the map you just built. What goes to storage is
 * the vessel, its objects and deposits, the interface settings and a sampled
 * snapshot of the swarm. The diffusion fields do not: they are tens of megabytes
 * and they rebuild from the motes and deposits within a few simulated minutes,
 * which is a much better trade than a storage quota.
 */

const KEY = 'goober.scene.v1'

export interface SavedUi {
  presetId: string
  selectedFoodId: string
  placeMassMg: number | null
  solidKindId: string
  solidMaterial: string
  solidDims: [number, number, number]
  solidRotated: boolean
  solidClimbable: boolean
  solidYaw: number
  wipeRadius: number
  brightness: number
  paletteId: string
  placementHeight: number
  panel: string
  speed: number
  showNetwork: boolean
  showVeins: boolean
  showMotes: boolean
  showPlane: boolean
}

interface StoredScene {
  version: number
  savedAt: number
  ui: SavedUi
  colony: Omit<ColonySnapshot, 'moteData' | 'moteState'> & {
    moteData: string
    moteState: string
  }
}

/** Chunked, because String.fromCharCode(...bytes) overflows the stack. */
function toBase64(bytes: Uint8Array): string {
  let out = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(out)
}

function fromBase64(text: string): Uint8Array {
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function saveScene(colony: Colony, ui: SavedUi): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    const snap = colony.snapshot()
    const stored: StoredScene = {
      version: 1,
      savedAt: Date.now(),
      ui,
      colony: {
        ...snap,
        moteData: toBase64(new Uint8Array(snap.moteData.buffer, 0, snap.moteCount * 9 * 4)),
        moteState: toBase64(snap.moteState),
      },
    }
    localStorage.setItem(KEY, JSON.stringify(stored))
    return true
  } catch {
    // Quota, private browsing, whatever: losing a save is never worth an error.
    return false
  }
}

export interface LoadedScene {
  ui: SavedUi
  snapshot: ColonySnapshot
}

export function loadScene(): LoadedScene | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as StoredScene
    if (stored.version !== 1) return null
    const dataBytes = fromBase64(stored.colony.moteData)
    const stateBytes = fromBase64(stored.colony.moteState)
    const snapshot: ColonySnapshot = {
      ...stored.colony,
      moteData: new Float32Array(dataBytes.buffer, dataBytes.byteOffset, dataBytes.length / 4),
      moteState: stateBytes,
    }
    return { ui: stored.ui, snapshot }
  } catch {
    return null
  }
}

export function clearScene(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing useful to do */
  }
}

export function hasSavedScene(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(KEY) !== null
  } catch {
    return false
  }
}
