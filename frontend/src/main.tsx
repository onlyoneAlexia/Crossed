import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import OrderRainBackground from './OrderRainBackground.tsx'
import { initTheme } from './lib/theme'

initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* always-on calm ambient backdrop: a gentle 8-bit "order rain" */}
    <OrderRainBackground />
    <App />
  </StrictMode>,
)
