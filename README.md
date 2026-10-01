# goober

An interactive 3D slime mould lab. Goober is a plasmodium of *Physarum polycephalum*
growing in a vessel of agar: you feed it, build things for it to climb, change the
weather, and watch what it does about it.

```bash
npm install
npm run dev
```

React 19 + Vite + three.js (react-three-fiber). Everything runs on the CPU in one
tab; there is no server and no build step beyond Vite.

## What it actually simulates

Each glowing dot is a **mote**: a coarse-grained packet of plasmodium with its own
heading, biomass and two internal nutrient stores. A mote smells the substrate a
short way ahead along a cone of sensors, turns towards whichever direction offers
most of what it currently lacks, and lays slime as it goes. Slime is itself an
attractant, so used paths get reinforced. Nothing about the network is drawn by
hand - it is the trail field, thresholded.

**Food is never eaten directly.** A deposit is digested outside the organism:
enzymes are secreted only where the plasmodium has actually arrived, each
macronutrient pool waits for the specific enzyme that cleaves it, and the products
diffuse through the agar as two currencies, carbon-equivalent and
protein-equivalent. Motes take those up with Michaelis-Menten kinetics, pay
maintenance respiration, and build biomass from whatever pairs up.

One lattice unit is **one millimetre**, and one voxel is **one microlitre** of agar.
Concentrations, osmolarities and diffusion coefficients are all in real units.

### Where the numbers come from

- **2:1 protein to carbohydrate** intake optimum by mass, from nutritional-geometry
  work on this species. The colony panel plots cumulative intake against it.
- **Haematin and thiamine are absolute requirements** - the organism cannot
  synthesise either, which is why every axenic medium supplies them. Run it on oats
  alone and it arrests with full carbon stores.
- Growth optimum near **26 °C** with a Q10 of 2.2, denaturing above 33 °C, dormant
  below 8 °C. Acid optimum around **pH 5.2**.
- Diffusion follows **Stokes-Einstein**: a peptide of ~500 g/mol travels at the cube
  root of (180/500) of glucose's rate, and both speed up as water thins with
  temperature. Glucose in agar is ~0.04 mm²/min, which is what the default is set to.
- **Enzymology decides what is food.** Amylase 95%, protease 85%, lipase 45%,
  chitinase 12%, β-galactosidase 4%, cellulase 0%. That last one is why a cellulose
  pad scores 184 kcal/100 g gross and exactly zero digestible, and why lactose makes
  milk a trap.
- Energy uses **Atwater factors** (4/4/9 kcal/g); gross energy is shown next to
  digestible energy so you can see how much of a food is a lie.
- **Osmolarity is computed from composition**, so salt, sugar crystals and honey
  repel before they ever feed.

### Weight, grip and tearing

With gravity above zero the vessel is a chamber rather than a supporting gel. A mote
can only climb if it is gripping something, and grip depends on the material: paper
and wood are easy, polystyrene is work, glass and steel are close to hopeless. Away
from any surface the only thing carrying it is the thickness of its own slime tube
and the tube behind it - which is how a real plasmodium bridges a gap, thickening the
span as it extends. Overreach and the front sags, then tears, and whatever was out
there falls. Objects also block diffusion, so a wall casts a real chemical shadow.

Set gravity to zero for gel mode, where the network grows freely in three dimensions.

### The tubes

Alongside the slime trail there is a persistent **transport network**. A tube
thickens in proportion to the cytoplasm flowing through it and is reabsorbed when
idle, so the network prunes itself down to the routes that are actually carrying
food. Those are the solid gold veins in the view - the paths the colony chose. Set
tube reabsorption to zero in the conditions panel to keep every tube it has ever
built and see the whole search history.

## The larder

Eighteen foods, each a real composition-table entry: rolled oats, glucose agar,
peptone broth, yeast extract, a bacterial lawn, semi-defined 2:1 medium, liver,
egg yolk, banana, honey, milk, sucrose, potato starch, a dead fly, a cellulose pad,
a salt crystal, quinine and coffee. The food panel shows the full breakdown - grams
per 100 g, which enzyme gates each fraction, how much is actually usable, gross
against digestible energy, P:C and C:N ratios, pH, osmolarity, minerals and
cofactors - and then, the part worth reading, **how much plasmodium that deposit
could build and which component runs out first**.

## Experiments

The scenario menu holds staged versions of real work: the Nakagaki maze, the
two-diet nutritional-geometry choice, the quinine bridge, a brine barrier, haematin
starvation and rescue, a long-range foraging run across a 128 mm vessel, a tower
climb, a shelf stack and a canyon that can only be crossed by building a span.

## Layout

```text
src/sim/     the simulation, with no dependency on React or three
  biology.ts   organism constants and response curves
  foods.ts     the food composition tables and derived analysis
  solids.ts    materials and obstacle shapes
  field.ts     3D scalar field: diffusion, decay, obstacles, active region
  env.ts       coarse pH / osmolarity / toxin grid
  colony.ts    motes, digestion, gravity, growth, statistics
  presets.ts   the experiments
src/three/   rendering
src/ui/      panels
tools/       headless harnesses: run with `npx vite build --ssr tools/<f>.ts --outDir .simtest`
             then `node .simtest/<f>.js`
```

`tools/simtest.ts` checks the food tables and runs the nutrition scenarios,
`tools/physics.ts` checks gravity, obstacles and timing, and `tools/climb.ts` probes
a single tower climb material by material.
