import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// No StrictMode: the simulation is a single mutable object that lives outside
// React, and double-invoked effects would double-drive it.
createRoot(document.getElementById('root')!).render(<App />)
