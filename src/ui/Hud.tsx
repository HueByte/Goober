import { useEffect } from 'react'
import { FOOD_BY_ID } from '../sim/foods'
import { PRESETS } from '../sim/presets'
import { MATERIALS, SOLID_KIND_BY_ID } from '../sim/solids'
import { PALETTES } from '../three/palette'
import { useStore } from '../state/store'
import { Slider, clock, fmt } from './controls'

const SPEEDS = [0.25, 1, 4, 12]

export function TopBar() {
  const stats = useStore((s) => s.stats)
  const grid = useStore((s) => s.params.grid)
  const paused = useStore((s) => s.paused)
  const speed = useStore((s) => s.speed)
  const presetId = useStore((s) => s.presetId)
  const togglePaused = useStore((s) => s.togglePaused)
  const setSpeed = useStore((s) => s.setSpeed)
  const loadPreset = useStore((s) => s.loadPreset)
  const saveNow = useStore((s) => s.saveNow)
  const savedAt = useStore((s) => s.savedAt)
  const showNetwork = useStore((s) => s.showNetwork)
  const showMotes = useStore((s) => s.showMotes)
  const showPlane = useStore((s) => s.showPlane)
  const toggleNetwork = useStore((s) => s.toggleNetwork)
  const showVeins = useStore((s) => s.showVeins)
  const toggleVeins = useStore((s) => s.toggleVeins)
  const toggleMotes = useStore((s) => s.toggleMotes)
  const togglePlane = useStore((s) => s.togglePlane)
  const paletteId = useStore((s) => s.paletteId)
  const setPalette = useStore((s) => s.setPalette)

  return (
    <div className="topbar">
      <div className="brand">
        <h1>goober</h1>
        <span>Physarum polycephalum · 3D plasmodium lab</span>
      </div>

      <div className="chips">
        <span className="chip">
          <b>{clock(stats?.timeMin ?? 0)}</b>
          <i>elapsed</i>
        </span>
        <span className="chip">
          <b>{fmt(stats?.biomassMg ?? 0, 2)} mg</b>
          <i>biomass</i>
        </span>
        <span className="chip">
          <b>{(stats?.motes ?? 0).toLocaleString()}</b>
          <i>motes</i>
        </span>
        <span className="chip">
          <b>
            {stats && isFinite(stats.pcRatio) ? `${stats.pcRatio.toFixed(2)}:1` : '—'}
          </b>
          <i>P:C intake</i>
        </span>
        <span className="chip">
          <b>{grid} mm</b>
          <i>vessel</i>
        </span>
      </div>

      <div className="controls-right">
        <select value={presetId} onChange={(e) => loadPreset(e.target.value)} title="scenario">
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button className="ghost-btn" onClick={() => loadPreset(presetId)} title="restart scenario">
          reset
        </button>
        <button
          className="ghost-btn"
          onClick={saveNow}
          title={savedAt ? `saved ${new Date(savedAt).toLocaleTimeString()}` : 'save the scene'}
        >
          save
        </button>
        <button className={`ghost-btn ${paused ? 'active' : ''}`} onClick={togglePaused}>
          {paused ? 'play' : 'pause'}
        </button>
        <div className="speeds">
          {SPEEDS.map((s) => (
            <button
              key={s}
              className={`ghost-btn tiny ${speed === s ? 'active' : ''}`}
              onClick={() => setSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>
        <div className="swatches" title="colour scheme">
          {PALETTES.map((p) => (
            <button
              key={p.id}
              className={`swatch-btn ${p.id === paletteId ? 'active' : ''}`}
              style={{ background: p.swatch }}
              onClick={() => setPalette(p.id)}
              title={p.name}
            />
          ))}
        </div>
        <div className="speeds">
          <button className={`ghost-btn tiny ${showMotes ? 'active' : ''}`} onClick={toggleMotes}>
            motes
          </button>
          <button className={`ghost-btn tiny ${showNetwork ? 'active' : ''}`} onClick={toggleNetwork}>
            slime
          </button>
          <button className={`ghost-btn tiny ${showVeins ? 'active' : ''}`} onClick={toggleVeins}>
            tubes
          </button>
          <button className={`ghost-btn tiny ${showPlane ? 'active' : ''}`} onClick={togglePlane}>
            plane
          </button>
        </div>
      </div>
    </div>
  )
}

export function Toolbar() {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const selectedFoodId = useStore((s) => s.selectedFoodId)
  const placementHeight = useStore((s) => s.placementHeight)
  const gravity = useStore((s) => s.env.gravity)
  const setPlacementHeight = useStore((s) => s.setPlacementHeight)
  const grid = useStore((s) => s.params.grid)
  const stats = useStore((s) => s.stats)
  const solidMaterial = useStore((s) => s.solidMaterial)
  const solidKindId = useStore((s) => s.solidKindId)
  const wipeRadius = useStore((s) => s.wipeRadius)
  const setWipeRadius = useStore((s) => s.setWipeRadius)
  const clearMould = useStore((s) => s.clearMould)
  const def = FOOD_BY_ID[selectedFoodId]

  const worst = stats?.diagnostics.find((d) => d.level === 'bad') ?? stats?.diagnostics.find((d) => d.level === 'warn')

  return (
    <div className="toolbar">
      <div className="tool-row">
        <button className={`tool ${tool === 'feed' ? 'active' : ''}`} onClick={() => setTool('feed')}>
          feed
          <span className="swatch" style={{ background: def.color }} />
        </button>
        <button className={`tool ${tool === 'build' ? 'active' : ''}`} onClick={() => setTool('build')}>
          build
          <span className="swatch" style={{ background: MATERIALS[solidMaterial].color }} />
        </button>
      </div>
      <div className="tool-row">
        <button
          className={`tool ${tool === 'inoculate' ? 'active' : ''}`}
          onClick={() => setTool('inoculate')}
        >
          inoculate
        </button>
        <button className={`tool ${tool === 'erase' ? 'active' : ''}`} onClick={() => setTool('erase')}>
          remove
        </button>
        <button className={`tool ${tool === 'wipe' ? 'active' : ''}`} onClick={() => setTool('wipe')}>
          wipe
        </button>
      </div>
      {tool === 'wipe' && (
        <>
          <Slider
            label="Wipe brush"
            value={wipeRadius}
            min={2}
            max={40}
            step={1}
            unit=" mm"
            digits={0}
            onChange={setWipeRadius}
          />
          <button className="ghost-btn" onClick={clearMould}>
            clear all mould
          </button>
        </>
      )}
      {gravity === 0 ? (
        <Slider
          label="Placement height"
        value={placementHeight}
        min={2}
        max={grid - 2}
        step={0.5}
        digits={1}
        hint={
          tool === 'feed'
            ? `placing ${def.name}`
            : tool === 'build'
              ? `placing ${SOLID_KIND_BY_ID[solidKindId]?.name ?? ''} in ${MATERIALS[solidMaterial].label}`
              : `${tool} tool`
        }
          onChange={setPlacementHeight}
        />
      ) : (
        <p className="ticker">
          Click the agar, an object or a deposit: whatever you point at is where it goes, and it
          rests on that surface.
        </p>
      )}
      {worst && <p className={`ticker ${worst.level}`}>{worst.text}</p>}
    </div>
  )
}

/** Space pauses, 1-4 pick a panel. */
export function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return
      const s = useStore.getState()
      if (e.code === 'Space') {
        e.preventDefault()
        s.togglePaused()
      } else if (e.key === '1') s.setPanel('food')
      else if (e.key === '2') s.setPanel('build')
      else if (e.key === '3') s.setPanel('environment')
      else if (e.key === '4') s.setPanel('colony')
      else if (e.key === '5') s.setPanel('about')
      else if (e.key === 'f') s.setTool('feed')
      else if (e.key === 'b') s.setTool('build')
      else if (e.key === 'i') s.setTool('inoculate')
      else if (e.key === 'x') s.setTool('erase')
      else if (e.key === 'w') s.setTool('wipe')
      else if (e.key === 'q' || e.key === 'e') {
        // Fifteen degrees a press, five with shift for fine work.
        const step = (e.shiftKey ? Math.PI / 36 : Math.PI / 12) * (e.key === 'q' ? -1 : 1)
        s.rotateSolid(step)
        if (s.tool !== 'build') s.setTool('build')
      }
      else if (e.key === 'r') s.toggleSolidRotated()
      else if (e.key === 'h' || e.code === 'Tab') {
        e.preventDefault()
        s.toggleUi()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
