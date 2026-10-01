/**
 * The three new behavioural mechanisms, measured rather than asserted.
 *
 *  - a lure: volatiles that carry far beyond anything the deposit has dissolved,
 *    so the colony sets off towards something that is not worth the walk;
 *  - narcosis: a compound that stops the streaming without doing damage;
 *  - desiccation: osmotic stress with no toxin behind it, which should produce
 *    encystment rather than death.
 */
import { Colony, DEFAULT_ENV, DEFAULT_PARAMS, FIXED_STEP_MIN } from '../src/sim/colony'

const grid = 96

function run(label: string, setup: (c: Colony) => void, hours: number) {
  const c = new Colony({ ...DEFAULT_PARAMS, grid, maxMotes: 40000 }, { ...DEFAULT_ENV })
  c.inoculate(24, 4, 48, 220, 2.4)
  c.addFood('bacteria-lawn', 24, 4, 48, 160)
  setup(c)
  for (let h = 0; h < hours; h++) for (let s = 0; s < 60 / FIXED_STEP_MIN; s++) c.step(FIXED_STEP_MIN)
  // How far east did the colony commit mass?
  let m = 0
  let sum = 0
  let past60 = 0
  let maxX = 0
  for (let i = 0; i < c.highWater; i++) {
    if (c.state[i] === 0) continue
    sum += c.px[i] * c.biomass[i]
    m += c.biomass[i]
    if (c.px[i] > 60) past60++
    if (c.px[i] > maxX) maxX = c.px[i]
  }
  const st = c.buildStats()
  console.log(
    `${label.padEnd(26)} centre x=${(m > 0 ? sum / m : 0).toFixed(1).padStart(5)} front=${maxX
      .toFixed(0)
      .padStart(3)} motes past x=60: ${String(past60).padStart(4)} | biomass ${st.biomassMg
      .toFixed(2)
      .padStart(5)}mg dormant ${String(st.dormant).padStart(4)}`,
  )
}

console.log('--- lure: is the colony drawn to a smell with nothing behind it? ---')
run('nothing out there', () => {}, 14)
run('plain agar at x=72', (c) => c.addFood('blank-agar', 72, 4, 48, 400), 14)
run('valerian at x=72', (c) => c.addFood('valerian-drop', 72, 4, 48, 150), 14)
run('real food at x=72', (c) => c.addFood('bacteria-lawn', 72, 4, 48, 300), 14)

console.log('')
console.log('--- narcosis: does caffeine stop the streaming without killing? ---')
run('clear run', () => {}, 10)
run('coffee ring around it', (c) => {
  for (let a = 0; a < 8; a++) {
    const t = (a / 8) * Math.PI * 2
    c.addFood('coffee-drop', 24 + Math.cos(t) * 10, 4, 48 + Math.sin(t) * 10, 250)
  }
}, 10)
run('quinine ring around it', (c) => {
  for (let a = 0; a < 8; a++) {
    const t = (a / 8) * Math.PI * 2
    c.addFood('quinine', 24 + Math.cos(t) * 10, 4, 48 + Math.sin(t) * 10, 80)
  }
}, 10)

console.log('')
console.log('--- desiccation: encystment, not death ---')
run('clear run', () => {}, 16)
run('glycerol on the colony', (c) => c.addFood('glycerol-drop', 26, 4, 48, 250), 16)
run('salt on the colony', (c) => c.addFood('salt-crystal', 26, 4, 48, 60), 16)
