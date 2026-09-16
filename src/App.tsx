import { Suspense, lazy } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider, useApp } from './state/app'
import { Shell } from './components/Shell'
import { Login } from './pages/Login'
import { Skeleton } from './components/ui'

/* Route-level code splitting keeps the first paint small on a phone —
   Recharts and the heavier tables only load when their screen is opened. */
const ControlTower = lazy(() => import('./pages/ControlTower').then((m) => ({ default: m.ControlTower })))
const Shipments = lazy(() => import('./pages/Shipments').then((m) => ({ default: m.Shipments })))
const LanePlanner = lazy(() => import('./pages/LanePlanner').then((m) => ({ default: m.LanePlanner })))
const ScenarioDrill = lazy(() => import('./pages/ScenarioDrill').then((m) => ({ default: m.ScenarioDrill })))
const Counterparties = lazy(() => import('./pages/Counterparties').then((m) => ({ default: m.Counterparties })))
const Fleet = lazy(() => import('./pages/Fleet').then((m) => ({ default: m.Fleet })))
const Compliance = lazy(() => import('./pages/Compliance').then((m) => ({ default: m.Compliance })))
const ApiConsole = lazy(() => import('./pages/ApiConsole').then((m) => ({ default: m.ApiConsole })))
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })))

function PageFallback() {
  return (
    <div className="space-y-3 p-4">
      <Skeleton className="h-7 w-52" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
      </div>
      <Skeleton className="h-72" />
    </div>
  )
}

function Routed() {
  const { session } = useApp()
  if (!session) return <Login />
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<ControlTower />} />
          <Route path="shipments" element={<Shipments />} />
          <Route path="plan" element={<LanePlanner />} />
        <Route path="drill" element={<ScenarioDrill />} />
        <Route path="parties" element={<Counterparties />} />
        <Route path="fleet" element={<Fleet />} />
          <Route path="compliance" element={<Compliance />} />
          <Route path="apis" element={<ApiConsole />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <Routed />
      </HashRouter>
    </AppProvider>
  )
}
