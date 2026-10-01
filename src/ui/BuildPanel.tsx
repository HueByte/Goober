import { MATERIALS, SOLID_KINDS, SOLID_KIND_BY_ID } from '../sim/solids'
import type { Material } from '../sim/solids'
import { BYTES_PER_VOXEL, maxGridSize } from '../sim/colony'
import { useStore } from '../state/store'
import { Row, Section, Slider, fmt } from './controls'

const MATERIAL_ORDER: Material[] = ['agar', 'paper', 'wood', 'plastic', 'glass', 'metal']

export function BuildPanel() {
  const solidKindId = useStore((s) => s.solidKindId)
  const selectSolid = useStore((s) => s.selectSolid)
  const material = useStore((s) => s.solidMaterial)
  const setMaterial = useStore((s) => s.setSolidMaterial)
  const dims = useStore((s) => s.solidDims)
  const setSolidDim = useStore((s) => s.setSolidDim)
  const resetSolidDims = useStore((s) => s.resetSolidDims)
  const rotated = useStore((s) => s.solidRotated)
  const toggleRotated = useStore((s) => s.toggleSolidRotated)
  const climbable = useStore((s) => s.solidClimbable)
  const toggleClimbable = useStore((s) => s.toggleSolidClimbable)
  const solids = useStore((s) => s.solids)
  const clearSolids = useStore((s) => s.clearSolids)
  const gravity = useStore((s) => s.env.gravity)
  const setEnvValue = useStore((s) => s.setEnvValue)
  const grid = useStore((s) => s.params.grid)
  const setParam = useStore((s) => s.setParam)
  const savedAt = useStore((s) => s.savedAt)
  const forgetSaved = useStore((s) => s.forgetSaved)
  const stats = useStore((s) => s.stats)

  const kind = SOLID_KIND_BY_ID[solidKindId]
  const mat = MATERIALS[material]
  const sphere = kind.shape === 'sphere'
  const shown: [number, number, number] = [...dims]
  if (rotated && kind.orientable) {
    const t = shown[0]
    shown[0] = shown[2]
    shown[2] = t
  }

  return (
    <div className="panel-body">
      <Section
        title="Vessel"
        subtitle="The size of the world. One lattice unit is one millimetre, so this is the plate you are building on."
      >
        <Slider
          label="Vessel size"
          value={grid}
          min={48}
          max={maxGridSize()}
          step={8}
          unit=" mm"
          digits={0}
          hint="Changing this rescales everything in the vessel. A bigger plate costs nothing until the colony spreads into it."
          onChange={(v) => setParam('grid', v)}
        />
        <div className="kv-grid">
          <Row label="Volume" value={`${(grid ** 3 / 1000).toFixed(0)} mL`} />
          <Row
            label="Field memory"
            value={`${((grid ** 3 * BYTES_PER_VOXEL) / 1048576).toFixed(0)} MB`}
            tone={grid ** 3 * BYTES_PER_VOXEL > 70 * 1048576 ? 'warn' : undefined}
          />
          <Row
            label="Autosaved"
            value={savedAt ? new Date(savedAt).toLocaleTimeString() : 'not yet'}
          />
        </div>
        <p className="note">
          The vessel, its objects, its deposits and the swarm are kept in this browser, so a reload
          picks up where you left off. The diffusion plumes are not stored — they rebuild themselves
          within a few simulated minutes.
        </p>
        <button className="ghost-btn" onClick={forgetSaved}>
          forget saved scene
        </button>
      </Section>

      <Section
        title="Objects"
        subtitle="Pick a shape, set its size, then click in the vessel. Objects rest on whatever is underneath, so they stack."
      >
        <div className="food-grid">
          {SOLID_KINDS.map((k) => (
            <button
              key={k.id}
              className={`food-chip ${k.id === solidKindId ? 'active' : ''}`}
              onClick={() => selectSolid(k.id)}
              title={k.blurb}
            >
              <span className="swatch" style={{ background: mat.color }} />
              <span className="food-chip-name">{k.name}</span>
            </button>
          ))}
        </div>
        <p className="note">{kind.blurb}</p>
      </Section>

      <Section
        title="Size"
        subtitle={sphere ? 'Diameter, in millimetres.' : 'Each axis in millimetres. One lattice unit is one millimetre.'}
      >
        {sphere ? (
          <Slider
            label="Diameter"
            value={dims[0]}
            min={2}
            max={Math.min(80, grid - 4)}
            step={1}
            unit=" mm"
            digits={0}
            onChange={(v) => setSolidDim(0, v)}
          />
        ) : (
          <>
            <Slider
              label="Length (X)"
              value={dims[0]}
              min={1}
              max={grid - 2}
              step={1}
              unit=" mm"
              digits={0}
              onChange={(v) => setSolidDim(0, v)}
            />
            <Slider
              label="Height (Y)"
              value={dims[1]}
              min={1}
              max={grid - 2}
              step={1}
              unit=" mm"
              digits={0}
              onChange={(v) => setSolidDim(1, v)}
            />
            <Slider
              label="Depth (Z)"
              value={dims[2]}
              min={1}
              max={grid - 2}
              step={1}
              unit=" mm"
              digits={0}
              onChange={(v) => setSolidDim(2, v)}
            />
          </>
        )}
        <div className="kv-grid">
          <Row
            label="Placed footprint"
            value={`${fmt(shown[0], 0)} × ${fmt(shown[2], 0)} mm, ${fmt(shown[1], 0)} mm tall`}
          />
        </div>
        <div className="tool-row">
          <button className="ghost-btn" onClick={resetSolidDims}>
            reset to default
          </button>
          {kind.orientable && (
            <button className={`ghost-btn ${rotated ? 'active' : ''}`} onClick={toggleRotated}>
              rotate 90° (r)
            </button>
          )}
        </div>
        {kind.orientable && (
          <p className="note">
            Objects are axis-aligned boxes in the simulation, so the only rotation available is the
            90° swap between the X and Z axes.
          </p>
        )}
      </Section>

      <Section
        title="Surface"
        subtitle="What a surface is made of decides whether the colony can climb it at all."
      >
        <div className="food-grid">
          {MATERIAL_ORDER.map((m) => (
            <button
              key={m}
              className={`food-chip ${m === material ? 'active' : ''}`}
              onClick={() => setMaterial(m)}
              title={MATERIALS[m].note}
            >
              <span className="swatch" style={{ background: MATERIALS[m].color }} />
              <span className="food-chip-name">{MATERIALS[m].label}</span>
            </button>
          ))}
        </div>
        <div className="kv-grid">
          <Row
            label="Grip"
            value={climbable ? `${(mat.adhesion * 100).toFixed(0)}%` : 'none — sheer'}
            tone={!climbable ? 'bad' : mat.adhesion > 0.7 ? 'good' : mat.adhesion > 0.45 ? 'warn' : 'bad'}
          />
        </div>
        <button
          className={`ghost-btn ${!climbable ? 'active' : ''}`}
          onClick={toggleClimbable}
        >
          {climbable ? 'make next object sheer' : 'sheer: cannot be climbed'}
        </button>
        <p className="note">
          {climbable
            ? mat.note
            : 'A sheer object offers no purchase at all: the plasmodium cannot grip it, is not drawn along it, and cannot rise beside it. This is how you build a maze whose walls are a real constraint. It needs gravity above zero to mean anything — in gel mode nothing is held down in the first place.'}
        </p>
      </Section>

      <Section
        title="Gravity"
        subtitle="How much weight the plasmodium has to hold up. At zero the vessel is a supporting gel and growth is freely three-dimensional."
      >
        <Slider
          label="Gravity"
          value={gravity}
          min={0}
          max={2}
          step={0.05}
          digits={2}
          hint="A span across open space is held only by the thickness of its own slime tube. Overreach and it sags, then tears."
          onChange={(v) => setEnvValue('gravity', v)}
        />
        <div className="kv-grid">
          <Row label="Gripping a surface" value={`${stats?.adhered ?? 0} motes`} />
          <Row
            label="Spanning open space"
            value={`${stats?.airborne ?? 0} motes`}
            tone={(stats?.airborne ?? 0) > (stats?.motes ?? 1) * 0.25 ? 'warn' : undefined}
          />
          <Row
            label="Spans torn"
            value={`${stats?.tears ?? 0}`}
            tone={(stats?.tears ?? 0) > 0 ? 'warn' : undefined}
          />
        </div>
      </Section>

      <Section title="In the vessel" subtitle={`${solids.length} objects placed.`}>
        <div className="kv-grid">
          {solids.slice(0, 14).map((s) => (
            <Row
              key={s.id}
              label={`${SOLID_KIND_BY_ID[s.kindId]?.name ?? s.kindId}${s.climbable ? '' : ' (sheer)'}`}
              value={`${fmt(s.hx * 2, 0)}×${fmt(s.hy * 2, 0)}×${fmt(s.hz * 2, 0)} mm`}
            />
          ))}
          {solids.length > 14 && <Row label="…" value={`${solids.length - 14} more`} />}
        </div>
        {solids.length > 0 && (
          <button className="ghost-btn" onClick={clearSolids}>
            clear all objects
          </button>
        )}
        <p className="note">Use the remove tool (x) and click an object to delete just that one.</p>
      </Section>
    </div>
  )
}
