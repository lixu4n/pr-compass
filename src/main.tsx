import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import CompassApp from './CompassApp'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.location.pathname === '/connect' ? <CompassApp /> : <App />}
  </React.StrictMode>,
)
