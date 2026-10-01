import { BIO } from '../sim/biology'
import { useStore } from '../state/store'
import { Meter, Row, Section, Stat, clock, fmt } from './controls'

const LIMIT_LABEL: Record<string, string> = {
  protein: 'protein / nitrogen',
  carbohydrate: 'carbon / energy',
  energy: 'starving',
  micronutrient: 'mineral or cofactor',
  balanced: 'nothing — balanced',
  none: 'no colony',
}

export function ColonyPanel() {
  const stats = useStore((s) => s.stats)
  const perf = useStore((s) => s.perf)
  if (!stats) return <div className="panel-body">No colony.</div>

  const pc = stats.pcRatio
  const pcText = !isFinite(pc) ? 'all protein' : `${pc.toFixed(2)} : 1`

  return (
    <div className="panel-body">
      <Section title="Colony" subtitle={`elapsed ${clock(stats.timeMin)} of simulated time`}>
        <div className="stat-grid">
          <Stat label="biomass" value={`${fmt(stats.biomassMg, 2)} mg`} sub={`peak ${fmt(stats.peakBiomassMg, 2)}`} />
          <Stat label="motes" value={stats.motes.toLocaleString()} sub={`${stats.dormant} encysted`} />
          <Stat
            label="growth"
            value={`${stats.growthRatePerHour >= 0 ? '+' : ''}${fmt(stats.growthRatePerHour * 100, 0)}%/h`}
            sub={`${stats.divisions} divisions`}
          />
          <Stat label="deaths" value={stats.deaths.toLocaleString()} sub={`network ${stats.networkVoxels.toLocaleString()} vx`} />
        </div>
        <Row label="Limited by" value={LIMIT_LABEL[stats.limiting] ?? stats.limiting} tone="warn" />
      </Section>

      <Section
        title="Nutritional geometry"
        subtitle={`Cumulative intake against the 2:1 protein:carbohydrate optimum.`}
      >
        <div className="pc-axis">
          <div className="pc-bar">
            <span
              className="pc-target"
              style={{ left: `${(BIO.optimum.proteinIntakeFraction * 100).toFixed(1)}%` }}
            />
            <span
              className="pc-marker"
              style={{
                left: `${(
                  (stats.intakeProtein / Math.max(1e-9, stats.intakeProtein + stats.intakeCarb)) *
                  100
                ).toFixed(1)}%`,
              }}
            />
          </div>
          <div className="pc-labels">
            <span>all carbon</span>
            <span>2:1 optimum</span>
            <span>all protein</span>
          </div>
        </div>
        <div className="kv-grid">
          <Row label="Intake ratio" value={pcText} tone={Math.abs(pc - 2) < 0.9 ? 'good' : 'warn'} />
          <Row label="Protein taken up" value={`${fmt(stats.intakeProtein / 1000, 3)} mg`} />
          <Row label="Carbon taken up" value={`${fmt(stats.intakeCarb / 1000, 3)} mg`} />
          <Row label="Growth yield" value={`${(stats.growthEfficiency * 100).toFixed(0)}%`} />
        </div>
      </Section>

      <Section title="Growth multipliers" subtitle="Everything currently multiplying the growth rate.">
        <Meter label="temperature" value={stats.factors.temperature} />
        <Meter label="local pH" value={stats.factors.ph} caption={`${stats.meanPh.toFixed(2)} pH`} />
        <Meter
          label="osmotic"
          value={stats.factors.osmotic}
          caption={`${stats.meanOsmolarity.toFixed(0)} mOsm`}
        />
        <Meter label="humidity" value={stats.factors.humidity} />
        <Meter label="light" value={stats.factors.light} />
        <Meter label="cofactors and minerals" value={stats.factors.micronutrient} />
        <Meter label="diet balance (reported)" value={stats.factors.balance} />
        <Meter label="combined" value={stats.factors.total} />
      </Section>

      <Section title="Substrate" subtitle="Dissolved nutrient waiting in the agar.">
        <div className="kv-grid">
          <Row label="Carbon pool" value={`${fmt(stats.substrateCarbUg / 1000, 2)} mg`} />
          <Row label="Protein pool" value={`${fmt(stats.substrateProteinUg / 1000, 2)} mg`} />
          <Row label="Food remaining" value={`${fmt(stats.foodRemainingMg, 1)} mg`} />
          <Row label="Mobilised so far" value={`${fmt(stats.assimilatedMg, 1)} mg`} />
          <Row label="Indigestible residue" value={`${fmt(stats.residueMg, 1)} mg`} tone="warn" />
          <Row label="Explored" value={`${(stats.exploredFraction * 100).toFixed(1)}% of vessel`} />
          <Row label="Transport tubes" value={`${stats.veinVolumeMm3.toLocaleString()} mm³`} />
        </div>
      </Section>

      <Section
        title="Minerals and cofactors"
        subtitle="Essential rows are marked; an empty essential pool stops growth outright."
      >
        <table className="comp-table">
          <thead>
            <tr>
              <th>pool</th>
              <th>µg held</th>
              <th>sufficiency</th>
            </tr>
          </thead>
          <tbody>
            {stats.traces.map((t) => (
              <tr key={t.id} className={t.essential ? 'essential' : undefined}>
                <td>
                  {t.label}
                  {t.essential ? ' *' : ''}
                </td>
                <td>{fmt(t.pool, 1)}</td>
                <td className={t.sufficiency < 0.35 ? 'bad' : t.sufficiency < 0.7 ? 'warn' : 'good'}>
                  {(t.sufficiency * 100).toFixed(0)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Readout" subtitle="What the model thinks is going on.">
        <ul className="diagnostics">
          {stats.diagnostics.map((d, i) => (
            <li key={i} className={d.level}>
              {d.text}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Performance" subtitle="">
        <div className="kv-grid">
          <Row label="Frame rate" value={`${perf.fps.toFixed(0)} fps`} />
          <Row label="Sim cost" value={`${perf.stepMs.toFixed(1)} ms/frame`} />
          <Row label="Substeps" value={`${perf.substeps}`} />
        </div>
      </Section>
    </div>
  )
}
