import { Canvas } from '@react-three/fiber'
import { useStore } from './state/store'
import type { Panel } from './state/store'
import { SlimeScene } from './three/SlimeScene'
import { AboutPanel } from './ui/AboutPanel'
import { BuildPanel } from './ui/BuildPanel'
import { ColonyPanel } from './ui/ColonyPanel'
import { EnvironmentPanel } from './ui/EnvironmentPanel'
import { FoodPanel } from './ui/FoodPanel'
import { TopBar, Toolbar, useHotkeys } from './ui/Hud'

const TABS: { id: Panel; label: string }[] = [
  { id: 'food', label: 'food' },
  { id: 'build', label: 'build' },
  { id: 'environment', label: 'conditions' },
  { id: 'colony', label: 'colony' },
  { id: 'about', label: 'model' },
]

export default function App() {
  const panel = useStore((s) => s.panel)
  const setPanel = useStore((s) => s.setPanel)
  const grid = useStore((s) => s.params.grid)
  const uiHidden = useStore((s) => s.uiHidden)
  const toggleUi = useStore((s) => s.toggleUi)
  useHotkeys()

  return (
    <div className="app">
      <Canvas
        camera={{ position: [grid * 0.85, grid * 0.5, grid * 0.85], fov: 45, near: 0.1, far: 2000 }}
        dpr={[1, 1.75]}
        // ACES tone mapping compresses the midtones hard, which is a lot of what
        // made the vessel read as black; a little exposure buys it back.
        gl={{ antialias: true, powerPreference: 'high-performance', toneMappingExposure: 1.05 }}
      >
        <SlimeScene />
      </Canvas>

      {uiHidden ? (
        <button className="ui-restore" onClick={toggleUi} title="show the interface (h)">
          ui
        </button>
      ) : (
        <>
          <TopBar />
          <Toolbar />
        </>
      )}

      {!uiHidden && (
      <aside className="panel">
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={panel === t.id ? 'active' : ''}
              onClick={() => setPanel(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        {panel === 'food' && <FoodPanel />}
        {panel === 'build' && <BuildPanel />}
        {panel === 'environment' && <EnvironmentPanel />}
        {panel === 'colony' && <ColonyPanel />}
        {panel === 'about' && <AboutPanel />}
      </aside>
      )}
    </div>
  )
}
