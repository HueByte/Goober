import { BIO, MATRIX, TRACE_LABEL } from '../sim/biology'
import {
  FOODS,
  FOOD_BY_ID,
  MACRO_ORDER,
  analyse,
  dispersedOsmolarity,
  foodMassMg,
  yieldPotential,
} from '../sim/foods'
import { colony, useStore } from '../state/store'
import type { ScatterSource } from '../state/store'
import type { FoodCategory, TraceId } from '../sim/types'
import { Row, Section, Slider, Tag, fmt } from './controls'

const CATEGORY_LABEL: Record<FoodCategory, string> = {
  classic: 'Laboratory classics',
  carbohydrate: 'Carbohydrate sources',
  protein: 'Nitrogen sources',
  complex: 'Complex / whole foods',
  defined: 'Defined media',
  stimulus: 'Cues and controls',
  antagonist: 'Antagonists',
}

const CATEGORY_ORDER: FoodCategory[] = [
  'classic',
  'defined',
  'protein',
  'carbohydrate',
  'complex',
  'stimulus',
  'antagonist',
]

const SCATTER_HINT: Record<ScatterSource, string> = {
  selected: 'Only the food selected above, which is the controlled version: one variable, scattered at random positions.',
  assorted: 'A random draw from everything edible. Composition varies deposit to deposit, so the colony has to choose where to put its mass rather than simply spreading.',
  chaotic:
    'The whole larder, antagonists included - roughly one deposit in four is salt, quinine, copper, acid or something else it would rather not have found. This is what an uncontrolled surface actually offers.',
}

function ratio(v: number): string {
  if (!isFinite(v)) return 'all protein'
  if (v === 0) return 'all carbon'
  return `${v.toFixed(2)} : 1`
}

export function FoodPanel() {
  const selectedFoodId = useStore((s) => s.selectedFoodId)
  const selectFood = useStore((s) => s.selectFood)
  const placeMassMg = useStore((s) => s.placeMassMg)
  const setPlaceMass = useStore((s) => s.setPlaceMass)
  const inspectedId = useStore((s) => s.inspectedInstanceId)
  const scatterFood = useStore((s) => s.scatterFood)
  const scatterCount = useStore((s) => s.scatterCount)
  const setScatterCount = useStore((s) => s.setScatterCount)
  const scatterRation = useStore((s) => s.scatterRation)
  const toggleScatterRation = useStore((s) => s.toggleScatterRation)
  const scatterHours = useStore((s) => s.scatterHours)
  const setScatterHours = useStore((s) => s.setScatterHours)
  const scatterSource = useStore((s) => s.scatterSource)
  const setScatterSource = useStore((s) => s.setScatterSource)
  const autoFeed = useStore((s) => s.autoFeed)
  const toggleAutoFeed = useStore((s) => s.toggleAutoFeed)
  const autoFeedHours = useStore((s) => s.autoFeedHours)
  const setAutoFeedHours = useStore((s) => s.setAutoFeedHours)
  const autoFeedReach = useStore((s) => s.autoFeedReach)
  const setAutoFeedReach = useStore((s) => s.setAutoFeedReach)
  const inspect = useStore((s) => s.inspect)

  const def = FOOD_BY_ID[selectedFoodId]
  const a = analyse(def)
  const mass = placeMassMg ?? def.defaultMassMg
  const potential = yieldPotential(def, mass)
  const instance = inspectedId ? colony.foods.find((f) => f.id === inspectedId) : undefined
  const instanceDef = instance ? FOOD_BY_ID[instance.defId] : undefined

  const traceRows = (Object.keys(def.traces) as TraceId[]).filter((t) => (def.traces[t] ?? 0) > 0)
  // The ration, stated in the units the question is actually asked in: what the
  // colony burns per hour, and what that comes to over the window chosen. A
  // number nobody can derive is a number nobody trusts.
  const rationTotal = colony.rationMassMg(selectedFoodId, scatterHours)
  const upkeepPerHour = scatterHours > 0 ? rationTotal / scatterHours : 0

  return (
    <div className="panel-body">
      <Section title="Larder" subtitle="Click a food, then click in the vessel to place it.">
        {CATEGORY_ORDER.map((cat) => {
          const items = FOODS.filter((f) => f.category === cat)
          if (items.length === 0) return null
          return (
            <div key={cat} className="food-group">
              <h4>{CATEGORY_LABEL[cat]}</h4>
              <div className="food-grid">
                {items.map((f) => (
                  <button
                    key={f.id}
                    className={`food-chip ${f.id === selectedFoodId ? 'active' : ''}`}
                    onClick={() => selectFood(f.id)}
                    title={f.blurb}
                  >
                    <span className="swatch" style={{ background: f.color }} />
                    <span className="food-chip-name">{f.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </Section>

      <Section title={def.name} subtitle={def.blurb}>
        <div className="tags">
          {a.tags.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
          <Tag>{MATRIX[def.matrix].label}</Tag>
        </div>

        <Slider
          label="Mass to place"
          value={mass}
          min={20}
          max={800}
          step={10}
          unit=" mg"
          digits={0}
          onChange={(v) => setPlaceMass(v)}
        />
        <h4 className="field-head">Scatter at random</h4>
        <Slider
          label="How many deposits"
          value={scatterCount}
          min={1}
          max={40}
          step={1}
          digits={0}
          onChange={setScatterCount}
        />

        <label className="field-label">What to drop</label>
        <div className="btn-row">
          {(['selected', 'assorted', 'chaotic'] as ScatterSource[]).map((s) => (
            <button
              key={s}
              className={`ghost-btn ${scatterSource === s ? 'active' : ''}`}
              onClick={() => setScatterSource(s)}
              title={SCATTER_HINT[s]}
            >
              {s === 'selected' ? 'this food' : s === 'assorted' ? 'mixed' : 'anything'}
            </button>
          ))}
        </div>
        <p className="note">{SCATTER_HINT[scatterSource]}</p>

        <label className="field-label">How much</label>
        <div className="btn-row">
          <button
            className={`ghost-btn ${scatterRation ? 'active' : ''}`}
            onClick={() => scatterRation || toggleScatterRation()}
          >
            just enough to live on
          </button>
          <button
            className={`ghost-btn ${scatterRation ? '' : 'active'}`}
            onClick={() => scatterRation && toggleScatterRation()}
          >
            a set amount
          </button>
        </div>
        {scatterRation ? (
          <>
            <Slider
              label="Enough to last"
              value={scatterHours}
              min={1}
              max={48}
              step={1}
              unit=" h"
              digits={0}
              onChange={setScatterHours}
            />
            <p className="note">
              The colony is burning {fmt(upkeepPerHour, 2)} mg an hour just staying alive, so{' '}
              {scatterHours} h of that is <strong>{fmt(rationTotal, 1)} mg</strong> - about{' '}
              {fmt(rationTotal / Math.max(1, scatterCount), 1)} mg in each of the {scatterCount}{' '}
              deposits. Drop that and it holds its current size: no boom, no die-back. Less and it
              shrinks; more and it grows.
            </p>
          </>
        ) : (
          <p className="note">
            Every deposit is the <strong>{fmt(mass, 0)} mg</strong> set above, whatever size the
            colony happens to be - so the same button feeds a seedling and starves a mature network.
          </p>
        )}

        <label className="field-label">Keep it fed</label>
        <div className="btn-row">
          <button
            className={`ghost-btn ${autoFeed ? 'active' : ''}`}
            onClick={toggleAutoFeed}
          >
            {autoFeed ? 'drip feed on' : 'drip feed off'}
          </button>
        </div>
        {autoFeed && (
          <>
            <Slider
              label="A scatter every"
              value={autoFeedHours}
              min={0.5}
              max={24}
              step={0.5}
              unit=" h"
              digits={1}
              onChange={setAutoFeedHours}
            />
            <Slider
              label="Dropped within"
              value={autoFeedReach}
              min={5}
              max={200}
              step={5}
              unit=" mm"
              digits={0}
              onChange={setAutoFeedReach}
            />
          </>
        )}
        <p className="note">
          {autoFeed
            ? `Every ${autoFeedHours} simulated hours, ${scatterCount} deposits land at random within ${autoFeedReach} mm of wherever the colony has got to. Set the reach wide and it has to keep travelling to eat; set it narrow and it settles where it is. The clock is in simulated time, so it means the same thing whatever speed you watch at.`
            : 'Off: the plate only gets what you put on it, so the colony eats what is there and then stops.'}
        </p>

        <button className="ghost-btn wide" onClick={() => scatterFood(scatterCount)}>
          drop {scatterCount}{' '}
          {scatterRation ? `(${fmt(rationTotal, 1)} mg in total)` : `(${fmt(mass, 0)} mg each)`}
        </button>
        <p className="note">
          Each lands on whatever is highest at that spot, so deposits end up on top of blocks and
          platforms as well as on the agar.
        </p>


        <div className="kv-grid">
          <Row label="Dry matter" value={`${fmt(a.dryMatter)} g / 100 g`} />
          <Row label="Gross energy" value={`${fmt(a.grossKcal, 0)} kcal / 100 g`} />
          <Row
            label="Digestible energy"
            value={`${fmt(a.digestibleKcal, 0)} kcal / 100 g`}
            tone={a.digestibleKcal < a.grossKcal * 0.6 ? 'warn' : undefined}
          />
          <Row
            label="Protein : carbohydrate"
            value={ratio(a.pcRatio)}
            tone={Math.abs(a.pcRatio - 2) < 0.9 ? 'good' : 'warn'}
          />
          <Row label="C : N (elemental)" value={isFinite(a.cnRatio) ? `${fmt(a.cnRatio)} : 1` : 'no nitrogen'} />
          <Row
            label="pH"
            value={def.ph.toFixed(1)}
            tone={Math.abs(def.ph - BIO.optimum.ph) < 0.8 ? 'good' : 'warn'}
          />
          <Row
            label={`Osmolarity in agar (${mass} mg)`}
            value={`${fmt(dispersedOsmolarity(def, mass), 0)} mOsm`}
            tone={dispersedOsmolarity(def, mass) > 400 ? 'bad' : undefined}
          />
          <Row
            label="Osmolarity undiluted"
            value={`${fmt(a.osmolarity, 0)} mOsm${a.anhydrous ? ' (anhydrous)' : ''}`}
          />
          <Row label="Enzyme access" value={`${(MATRIX[def.matrix].access * 100).toFixed(0)}%`} />
        </div>

        <h4 className="table-title">Composition, g per 100 g</h4>
        <table className="comp-table">
          <thead>
            <tr>
              <th>fraction</th>
              <th>g</th>
              <th>enzyme</th>
              <th>usable</th>
            </tr>
          </thead>
          <tbody>
            <tr className="muted">
              <td>water</td>
              <td>{fmt(def.comp.water)}</td>
              <td>&mdash;</td>
              <td>&mdash;</td>
            </tr>
            {MACRO_ORDER.filter((m) => m !== 'water' && def.comp[m] > 0).map((m) => {
              const b = a.breakdown.find((x) => x.macro === m)
              if (!b) return null
              const blocked = b.capability < 0.1 && b.grams > 0
              return (
                <tr key={m} className={blocked ? 'blocked' : undefined}>
                  <td>{b.label}</td>
                  <td>{fmt(b.grams)}</td>
                  <td className="enzyme">
                    {b.enzyme ? `${b.enzyme} ${(b.capability * 100).toFixed(0)}%` : 'none needed'}
                  </td>
                  <td>{fmt(b.usableGrams)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {a.residue > 0.5 && (
          <p className="note">
            {fmt(a.residue)} g per 100 g cannot be mobilised at all and stays behind as residue.
          </p>
        )}

        <h4 className="table-title">What {mass} mg of this could build</h4>
        <div className="kv-grid">
          <Row
            label="Potential biomass"
            value={`${fmt(potential.biomassMg, 2)} mg`}
            tone={potential.biomassMg < 1 ? 'bad' : 'good'}
          />
          <Row label="Limited by" value={potential.limitedBy} tone="warn" />
          <Row label="Protein side supports" value={`${fmt(potential.byProtein, 2)} mg`} />
          <Row label="Carbon side supports" value={`${fmt(potential.byCarb, 2)} mg`} />
        </div>

        {traceRows.length > 0 && (
          <>
            <h4 className="table-title">Minerals and cofactors, mg per 100 g</h4>
            <table className="comp-table">
              <thead>
                <tr>
                  <th>element</th>
                  <th>mg</th>
                  <th>supports</th>
                </tr>
              </thead>
              <tbody>
                {traceRows.map((t) => {
                  const p = potential.byTrace.find((x) => x.id === t)
                  const essential = BIO.biomass.essentialTraces.includes(t)
                  return (
                    <tr key={t} className={essential ? 'essential' : undefined}>
                      <td>{TRACE_LABEL[t]}</td>
                      <td>{fmt(def.traces[t] ?? 0, 2)}</td>
                      <td>{p ? `${fmt(p.supportsMg, 1)} mg` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )}
        {(def.traces.heme ?? 0) === 0 && (
          <p className="note warn">
            No haem iron. Physarum cannot synthesise haematin, so a diet of this alone eventually
            arrests however good the macronutrients are.
          </p>
        )}

        {def.toxins.length > 0 && (
          <>
            <h4 className="table-title">Toxins</h4>
            {def.toxins.map((t) => (
              <div key={t.name} className="toxin">
                <b>{t.name}</b>
                <span>
                  {fmt(t.mgPer100g, 0)} mg / 100 g &middot; repellency {t.repellency.toFixed(2)}
                </span>
                <p>{t.note}</p>
              </div>
            ))}
          </>
        )}

        <ul className="notes">
          {def.notes.map((nn) => (
            <li key={nn}>{nn}</li>
          ))}
        </ul>
      </Section>

      {instance && instanceDef && (
        <Section
          title={`Deposit: ${instanceDef.name}`}
          subtitle={`placed at ${instance.createdAtMin.toFixed(0)} min · ${fmt(
            foodMassMg(instance),
            1,
          )} of ${instance.initialMassMg} mg left`}
        >
          <div className="kv-grid">
            <Row label="Colonisation" value={`${(instance.colonization * 100).toFixed(0)}%`} />
            <Row label="Mobilised" value={`${fmt(instance.assimilatedMg, 2)} mg`} />
            <Row label="Residue" value={`${fmt(instance.residueMg, 2)} mg`} />
          </div>
          <table className="comp-table">
            <thead>
              <tr>
                <th>pool</th>
                <th>mg left</th>
                <th>of</th>
              </tr>
            </thead>
            <tbody>
              {MACRO_ORDER.filter((m) => (instanceDef.comp[m] ?? 0) > 0).map((m) => {
                const start = (instanceDef.comp[m] / 100) * instance.initialMassMg
                const left = instance.pools[m]
                return (
                  <tr key={m}>
                    <td>{m}</td>
                    <td>{fmt(left, 2)}</td>
                    <td className="muted">{fmt(start, 2)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <button className="ghost-btn" onClick={() => inspect(null)}>
            close deposit
          </button>
        </Section>
      )}
    </div>
  )
}
