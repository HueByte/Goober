import { BIO, ENZYMES } from '../sim/biology'
import type { EnzymeId } from '../sim/types'
import { Row, Section } from './controls'

export function AboutPanel() {
  return (
    <div className="panel-body">
      <Section title="What this is" subtitle="Goober is a plasmodium of Physarum polycephalum, in a block of agar.">
        <p className="prose">
          Every glowing dot is a <b>mote</b>: a coarse-grained packet of plasmodium with its own
          heading, biomass and two internal nutrient stores. A mote smells the substrate a short
          way ahead of itself along a cone of sensors, turns towards whichever direction offers the
          most of what it currently lacks, and lays down slime as it goes. Slime is itself an
          attractant, so paths that get used get reinforced, and that feedback is where the veins
          come from. Nothing about the network is drawn: it is the trail field, thresholded.
        </p>
        <p className="prose">
          Food is never eaten directly. A deposit is digested <b>outside</b> the organism: enzymes
          are secreted only where the plasmodium has actually arrived, every macronutrient waits for
          the specific enzyme that cleaves it, and the products diffuse through the agar as two
          currencies — carbon-equivalent and protein-equivalent. Motes then take those up with
          Michaelis-Menten kinetics, pay maintenance respiration, and build biomass out of whatever
          pairs up.
        </p>
      </Section>

      <Section title="Colour key" subtitle="">
        <ul className="legend">
          <li>
            <span className="dot" style={{ background: '#2fb8ff' }} /> cold cyan — a hungry, fast,
            exploring tip
          </li>
          <li>
            <span className="dot" style={{ background: '#ffd85c' }} /> warm yellow — a fed mote in a
            working transport vein
          </li>
          <li>
            <span className="dot" style={{ background: '#6b3d10' }} /> dull amber — a sclerotium: an
            encysted, dormant mote waiting for food
          </li>
          <li>
            <span className="dot" style={{ background: '#3f7f96' }} /> cool dust — deposited slime:
            everywhere the colony has searched
          </li>
          <li>
            <span className="dot" style={{ background: '#f0ae33' }} /> warm gold cord — the transport
            network it has committed to. A tube thickens in proportion to the cytoplasm flowing
            through it and is reabsorbed when idle, so the points get denser and hotter along the
            routes the colony chose. Turn tube reabsorption down to zero to keep the whole history.
          </li>
          <li>
            <span className="dot" style={{ background: '#8ef0c0' }} /> green wireframe — a deposit
            the colony has colonised and is secreting enzyme onto
          </li>
        </ul>
      </Section>

      <Section
        title="Weight, grip and tearing"
        subtitle="With gravity above zero the vessel is a chamber, not a supporting gel."
      >
        <p className="prose">
          A mote can only go up if it is holding on to something. The agar floor and any object it
          is touching give it purchase, and how much purchase depends on the material: filter paper
          and wood are easy, polystyrene is work, glass and steel are close to hopeless. Away from
          every surface the only thing carrying it is the thickness of its own slime tube, and the
          tube behind it, which is how a real plasmodium bridges a gap - the span thickens as it
          extends. Reach out further than the tube can carry and the front sags, then tears, and
          whatever was out there falls.
        </p>
        <p className="prose">
          Objects also block diffusion, so a wall casts a real chemical shadow: food on the far side
          of it cannot be smelled through it, only around it.
        </p>
      </Section>

      <Section title="Controls" subtitle="">
        <ul className="legend">
          <li>drag to orbit, scroll to zoom</li>
          <li>
            pick a food or an object and click in the vessel. Clicks land on real geometry, so
            whatever you point at - agar, an object, another deposit - is what it rests on
          </li>
          <li>with gravity off there is nothing to rest on, so a height slider appears instead</li>
          <li>the inoculate tool drops a new knot of plasmodium</li>
          <li>the remove tool deletes the deposit or object you click on</li>
          <li>double-click a deposit to inspect what is left of each of its pools</li>
          <li>space pauses; 1—5 switch panels; f, b, i and x pick a tool</li>
        </ul>
      </Section>

      <Section
        title="Enzyme profile"
        subtitle="What this organism can and cannot break down. These numbers decide which foods work."
      >
        {(Object.keys(ENZYMES) as EnzymeId[]).map((id) => (
          <div key={id} className="enzyme-row">
            <Row
              label={ENZYMES[id].label}
              value={`${(ENZYMES[id].capability * 100).toFixed(0)}%`}
              tone={ENZYMES[id].capability < 0.1 ? 'bad' : ENZYMES[id].capability < 0.6 ? 'warn' : 'good'}
            />
            <p className="note">{ENZYMES[id].note}</p>
          </div>
        ))}
      </Section>

      <Section title="Where the numbers come from" subtitle="The model is tuned to published values for this species.">
        <ul className="legend">
          <li>
            Intake optimum of <b>2:1 protein to carbohydrate</b> by mass, from nutritional-geometry
            work on <i>P. polycephalum</i>. Deviating from it is exactly what the diet-balance
            read-out measures.
          </li>
          <li>
            <b>Haematin and thiamine are absolute requirements</b> — the organism cannot synthesise
            either, which is why every axenic medium supplies them. Run it on oats alone and watch it
            arrest with full carbon stores.
          </li>
          <li>
            Optimum near <b>{BIO.optimum.temperatureC} °C</b> with a Q10 of {BIO.tolerance.q10},
            denaturing above {BIO.tolerance.heatDamageAboveC} °C, dormant below{' '}
            {BIO.tolerance.coldDormancyBelowC} °C.
          </li>
          <li>
            Acid optimum around <b>pH {BIO.optimum.ph}</b>, which is why fruit works better than
            broth.
          </li>
          <li>
            Diffusion follows Stokes-Einstein: a peptide of ~500 g/mol travels at the cube root of
            (180/500) of glucose's rate, and both speed up as water thins with temperature.
          </li>
          <li>
            Osmolarity is computed from the food's own composition, so anhydrous things — salt,
            sugar crystals, honey — repel before they ever feed.
          </li>
          <li>
            Energy uses Atwater factors, 4/4/9 kcal per gram, and gross energy is reported next to
            digestible energy so you can see how much of a food is a lie.
          </li>
          <li>
            Biomass stoichiometry: {BIO.biomass.proteinEqPerUg} µg protein-equivalent and{' '}
            {BIO.biomass.carbEqPerUg} µg carbon-equivalent per µg of new plasmodium, plus{' '}
            {BIO.biomass.anabolicOverhead} µg burned to power the synthesis.
          </li>
        </ul>
      </Section>
    </div>
  )
}
