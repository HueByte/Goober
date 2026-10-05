import {
  BIO,
  humidityFactor,
  motilityFactor,
  osmoticFactor,
  phFactor,
  temperatureFactor,
} from '../sim/biology'
import { useStore } from '../state/store'
import { PALETTES } from '../three/palette'
import { Row, Section, Slider } from './controls'

export function EnvironmentPanel() {
  const env = useStore((s) => s.env)
  const params = useStore((s) => s.params)
  const setEnvValue = useStore((s) => s.setEnvValue)
  const setParam = useStore((s) => s.setParam)
  const brightness = useStore((s) => s.brightness)
  const setBrightness = useStore((s) => s.setBrightness)
  const paletteId = useStore((s) => s.paletteId)
  const setPalette = useStore((s) => s.setPalette)

  return (
    <div className="panel-body">
      <Section
        title="Incubator"
        subtitle="Physical conditions. Every one of these feeds a named response curve."
      >
        <Slider
          label="Temperature"
          value={env.temperatureC}
          min={4}
          max={40}
          step={0.5}
          unit=" °C"
          digits={1}
          hint={`metabolic rate ${(temperatureFactor(env.temperatureC) * 100).toFixed(0)}% — Q10 ${BIO.tolerance.q10}, optimum ${BIO.optimum.temperatureC} °C, dormant below ${BIO.tolerance.coldDormancyBelowC} °C`}
          onChange={(v) => setEnvValue('temperatureC', v)}
        />
        <Slider
          label="Relative humidity"
          value={env.relativeHumidity}
          min={30}
          max={100}
          step={1}
          unit=" %"
          digits={0}
          hint={`motility and growth ${(humidityFactor(env.relativeHumidity) * 100).toFixed(0)}% — desiccation below ${BIO.tolerance.desiccationBelowRh}%`}
          onChange={(v) => setEnvValue('relativeHumidity', v)}
        />
        <Slider
          label="Substrate pH"
          value={env.substratePh}
          min={3}
          max={9}
          step={0.1}
          unit=""
          digits={1}
          hint={`uptake ${(phFactor(env.substratePh) * 100).toFixed(0)}% — optimum pH ${BIO.optimum.ph}; food deposits shift local pH`}
          onChange={(v) => setEnvValue('substratePh', v)}
        />
        <Slider
          label="Substrate osmolarity"
          value={env.substrateOsmolarity}
          min={10}
          max={800}
          step={5}
          unit=" mOsm"
          digits={0}
          hint={`osmotic factor ${(osmoticFactor(env.substrateOsmolarity) * 100).toFixed(0)}% — damage above ${BIO.tolerance.osmoDamageAbove} mOsm`}
          onChange={(v) => setEnvValue('substrateOsmolarity', v)}
        />
        <Slider
          label="Illumination"
          value={env.illumination}
          min={0}
          max={1}
          step={0.01}
          hint="negative phototaxis steers the front away from the lamp; light plus starvation triggers sporulation"
          onChange={(v) => setEnvValue('illumination', v)}
        />
        <Slider
          label="Gravity"
          value={env.gravity}
          min={0}
          max={2}
          step={0.05}
          digits={2}
          hint="0 makes the vessel a supporting gel and growth becomes freely three-dimensional. Above 0 the colony must grip a surface to climb, and unsupported spans sag and tear."
          onChange={(v) => setEnvValue('gravity', v)}
        />
        <Slider
          label="Agar"
          value={env.agarPercent}
          min={0.4}
          max={3}
          step={0.05}
          unit=" % w/v"
          digits={2}
          hint={`motility ${(motilityFactor(env.agarPercent) * 100).toFixed(0)}% — best grip around 1.5%`}
          onChange={(v) => setEnvValue('agarPercent', v)}
        />
      </Section>

      <Section
        title="View"
        subtitle="How brightly the scene is lit. This is a display setting, not a condition the colony experiences."
      >
        <Slider
          label="Scene brightness"
          value={brightness}
          min={0.3}
          max={2.5}
          step={0.05}
          unit="×"
          digits={2}
          onChange={setBrightness}
        />
        <h4 className="table-title">Colour scheme</h4>
        <div className="food-grid">
          {PALETTES.map((p) => (
            <button
              key={p.id}
              className={`food-chip ${p.id === paletteId ? 'active' : ''}`}
              onClick={() => setPalette(p.id)}
            >
              <span
                className="swatch"
                style={{
                  background: `linear-gradient(90deg, rgb(${p.coolTube
                    .map((v) => Math.round(v * 255))
                    .join(',')}), rgb(${p.hotTube.map((v) => Math.round(v * 255)).join(',')}))`,
                }}
              />
              <span className="food-chip-name">{p.name}</span>
            </button>
          ))}
        </div>
        <p className="note">
          The scheme is a ramp, not one colour: the cool end is a path that is merely walked, the hot
          end a vein carrying cytoplasm. A tube being reabsorbed slides back down the ramp and dims
          out rather than changing hue.
        </p>
      </Section>

      <Section title="Time" subtitle="The colony doubles in about four hours at its best.">
        <Slider
          label="Sim minutes per second"
          value={params.minutesPerSecond}
          min={1}
          max={120}
          step={1}
          digits={0}
          onChange={(v) => setParam('minutesPerSecond', v)}
        />
      </Section>

      <Section
        title="Plasmodium behaviour"
        subtitle="The agent rules. Sensor geometry is what actually decides whether you get veins or fog."
      >
        <Slider
          label="Sensor distance"
          value={params.sensorDistance}
          min={0.6}
          max={6}
          step={0.1}
          onChange={(v) => setParam('sensorDistance', v)}
        />
        <Slider
          label="Sensor cone angle"
          value={params.sensorAngle}
          min={0.1}
          max={1.4}
          step={0.02}
          unit=" rad"
          onChange={(v) => setParam('sensorAngle', v)}
        />
        <Slider
          label="Sensors per cone"
          value={params.sensorCount}
          min={3}
          max={10}
          step={1}
          digits={0}
          onChange={(v) => setParam('sensorCount', v)}
        />
        <Slider
          label="Sensing stride"
          value={params.sensorStride}
          min={1}
          max={4}
          step={1}
          digits={0}
          hint="steps a mote keeps its heading before sensing again. Sensing dominates the cost of a large swarm, so 2 roughly halves it; 1 is the most faithful."
          onChange={(v) => setParam('sensorStride', v)}
        />
        <Slider
          label="Turn rate"
          value={params.turnRate}
          min={0.05}
          max={3}
          step={0.05}
          onChange={(v) => setParam('turnRate', v)}
        />
        <Slider
          label="Advance speed"
          value={params.speed}
          min={0.05}
          max={1.2}
          step={0.01}
          onChange={(v) => setParam('speed', v)}
        />
        <Slider
          label="Randomness"
          value={params.randomness}
          min={0}
          max={0.8}
          step={0.01}
          onChange={(v) => setParam('randomness', v)}
        />
        <Slider
          label="Trail affinity"
          value={params.trailAffinity}
          min={0}
          max={4}
          step={0.05}
          hint="how strongly motes follow their own slime — the source of tube formation"
          onChange={(v) => setParam('trailAffinity', v)}
        />
        <Slider
          label="Nutrient affinity"
          value={params.nutrientAffinity}
          min={0}
          max={6}
          step={0.05}
          onChange={(v) => setParam('nutrientAffinity', v)}
        />
        <Slider
          label="Recruitment"
          value={params.recruitment}
          min={0}
          max={8}
          step={0.1}
          hint="how loudly a nucleus that is feeding tells the rest of the organism, and how hard the rest answers. At zero every nucleus is on its own and a find grows a colony where it was found; raised, the body moves onto what it has found."
          onChange={(v) => setParam('recruitment', v)}
        />
        <Slider
          label="Cohesion"
          value={params.cohesion}
          min={0}
          max={6}
          step={0.05}
          hint="how strongly it holds together as one cell. At zero it behaves as a cloud of independent foragers; raise it and it becomes a single mass that bulges towards food."
          onChange={(v) => setParam('cohesion', v)}
        />
        <Slider
          label="Cytoplasmic streaming"
          value={params.circulation}
          min={0}
          max={1.5}
          step={0.01}
          hint="how fast food taken up anywhere on the network is pumped to wherever it is needed. At zero every mote is on its own."
          onChange={(v) => setParam('circulation', v)}
        />
        <Slider
          label="Surface affinity"
          value={params.surfaceAffinity}
          min={0}
          max={5}
          step={0.05}
          hint="thigmotaxis: how eagerly the front spreads along a surface it can grip, and therefore how readily it climbs"
          onChange={(v) => setParam('surfaceAffinity', v)}
        />
        <Slider
          label="Repellent aversion"
          value={params.repellentAversion}
          min={0}
          max={6}
          step={0.05}
          hint="scaled down by hunger: a starving colony will cross a barrier"
          onChange={(v) => setParam('repellentAversion', v)}
        />
      </Section>

      <Section title="Substrate transport" subtitle="Diffusion and turnover of the two currencies and of slime.">
        <Slider
          label="Slime deposition"
          value={params.depositRate}
          min={0}
          max={20}
          step={0.5}
          digits={1}
          onChange={(v) => setParam('depositRate', v)}
        />
        <Slider
          label="Slime decay"
          value={params.trailDecayPerMin}
          min={0.002}
          max={0.3}
          step={0.002}
          unit=" /min"
          digits={3}
          onChange={(v) => setParam('trailDecayPerMin', v)}
        />
        <Slider
          label="Tube reabsorption"
          value={params.veinDecayPerMin}
          min={0}
          max={0.01}
          step={0.0002}
          unit=" /min"
          digits={4}
          hint="how fast an idle transport tube is taken back. Zero keeps every tube the colony has ever built, which makes the whole search history visible."
          onChange={(v) => setParam('veinDecayPerMin', v)}
        />
        <Slider
          label="Slime diffusion"
          value={params.trailDiffusion}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => setParam('trailDiffusion', v)}
        />
        <Slider
          label="Nutrient diffusion"
          value={params.nutrientDiffusion}
          min={0.02}
          max={1}
          step={0.01}
          hint="peptides diffuse at (180/500)^(1/3) of the glucose rate, and both rise with temperature"
          onChange={(v) => setParam('nutrientDiffusion', v)}
        />
        <Slider
          label="Nutrient turnover"
          value={params.nutrientDecayPerMin}
          min={0}
          max={0.05}
          step={0.001}
          unit=" /min"
          digits={3}
          hint="microbial competition and abiotic loss in the agar"
          onChange={(v) => setParam('nutrientDecayPerMin', v)}
        />
      </Section>

      <Section title="Resolution" subtitle="Changing either of these restarts the colony.">
        <Slider
          label="Vessel size"
          value={params.grid}
          min={48}
          max={1000}
          step={8}
          unit=" mm"
          digits={0}
          hint="One lattice unit is one millimetre, so one voxel is one microlitre of agar. A bigger vessel costs nothing until the colony spreads into it."
          onChange={(v) => setParam('grid', v)}
        />
        <Slider
          label="Mote budget"
          value={params.maxMotes}
          min={2000}
          max={150000}
          step={1000}
          digits={0}
          hint="Restarts the colony. A 128 mm vessel wants 60000 or more to fill out."
          onChange={(v) => setParam('maxMotes', v)}
        />
        <Row label="Voxels" value={(params.grid ** 3).toLocaleString()} />
        <Row label="Vessel volume" value={`${(params.grid ** 3 / 1e6).toFixed(2)} L`} />
      </Section>
    </div>
  )
}
