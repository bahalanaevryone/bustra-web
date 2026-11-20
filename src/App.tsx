import { Route, Routes, Link } from 'react-router-dom'
import { PublicLayout } from './layouts/PublicLayout'
import { Home } from './pages/Home'
import { MapPage } from './pages/MapPage'
import { Schedules } from './pages/Schedules'
import { About } from './pages/About'
import { AuthPage } from './pages/AuthPage'
import { Account } from './pages/Account'
import { Protected } from './features/auth/Protected'
import { Dashboard } from './pages/Dashboard'
export function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<Home />} />
        <Route path="map" element={<MapPage />} />
        <Route path="schedules" element={<Schedules />} />
        <Route path="about" element={<About />} />
        <Route
          path="requests"
          element={
            <Protected>
              <Account />
            </Protected>
          }
        />
        <Route
          path="*"
          element={
            <div className="container page-space">
              <h1>We couldn’t find that stop.</h1>
              <p>This page may have moved.</p>
              <Link className="button button-primary" to="/">
                Return home
              </Link>
            </div>
          }
        />
      </Route>
      <Route path="login" element={<AuthPage key="login" mode="login" />} />
      <Route path="register" element={<AuthPage key="register" mode="register" />} />
      <Route path="reset-password" element={<AuthPage key="reset" mode="reset" />} />
      <Route path="update-password" element={<AuthPage key="update" mode="update-password" />} />
      <Route
        path="employee"
        element={
          <Protected roles={['employee']}>
            <Dashboard kind="employee" />
          </Protected>
        }
      />
      <Route
        path="admin"
        element={
          <Protected roles={['admin']}>
            <Dashboard kind="admin" />
          </Protected>
        }
      />
    </Routes>
  )
}
