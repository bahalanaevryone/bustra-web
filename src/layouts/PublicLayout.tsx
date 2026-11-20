import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { Menu, X, MapPin, LogOut } from 'lucide-react'
import { Brand, Notice } from '../components/ui'
import { useAuth } from '../features/auth/AuthProvider'
import { useData } from '../hooks/useData'
import { errorMessage } from '../lib/utils'

export function PublicLayout() {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const { user, profile, logout } = useAuth()
  const { demo, setDemo } = useData()
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="utility-bar">
        <div className="container">
          <span>
            <MapPin size={13} /> Mamburao, Occidental Mindoro
          </span>
          <span>Your journey, connected.</span>
        </div>
      </div>
      <header className="site-header">
        <div className="container header-inner">
          <Brand />
          <button
            className="icon-button menu-toggle"
            aria-label={open ? 'Close navigation' : 'Open navigation'}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
          <nav
            className={open ? 'public-nav open' : 'public-nav'}
            aria-label="Main navigation"
            onClick={() => setOpen(false)}
          >
            <NavLink to="/" end>
              Home
            </NavLink>
            <NavLink to="/map">Live Map</NavLink>
            <NavLink to="/schedules">Schedules</NavLink>
            <NavLink to="/about">About</NavLink>
            <div className="nav-auth">
              {user ? (
                <>
                  <Link
                    to={
                      profile?.role === 'admin'
                        ? '/admin'
                        : profile?.role === 'employee'
                          ? '/employee'
                          : '/requests'
                    }
                    className="button button-primary"
                  >
                    {profile?.role === 'user' ? 'My account' : 'Dashboard'}
                  </Link>
                  <button
                    className="icon-button"
                    aria-label="Log out"
                    onClick={() => {
                      void logout().catch((e) => setError(errorMessage(e)))
                    }}
                  >
                    <LogOut size={19} />
                  </button>
                </>
              ) : (
                <>
                  <Link to="/login" className="button button-outline">
                    Log in
                  </Link>
                  <Link to="/register" className="button button-primary">
                    Sign up
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      </header>
      {demo && (
        <div className="demo-banner">
          <div className="container">
            <span>
              <strong>DEMO MODE</strong> Illustrative buses, stops, and schedules. No actual service
              or live GPS.
            </span>
            <button onClick={() => setDemo(false)}>Exit demo</button>
          </div>
        </div>
      )}
      {error && (
        <div className="container">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <main id="main">
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="container footer-top">
          <div>
            <Brand light />
            <p>
              Less waiting. More knowing.
              <br />
              Bus tracking and passenger pickup requests.
            </p>
          </div>
          <div className="footer-links">
            <Link to="/map">Live map</Link>
            <Link to="/schedules">Schedules</Link>
            <Link to="/about">About BUSTRA</Link>
            <Link to="/login">Staff sign in</Link>
          </div>
          <div className="footer-location">
            <MapPin size={18} />
            <div>
              Mamburao, Occidental Mindoro<p>Built for a more connected journey.</p>
            </div>
          </div>
        </div>
        <div className="container footer-bottom">
          <span>© {new Date().getFullYear()} BUSTRA. A BSIT capstone project.</span>
          <span>Pickup requests are subject to driver confirmation.</span>
        </div>
      </footer>
    </>
  )
}
