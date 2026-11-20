import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Eye, EyeOff, Mail, LockKeyhole, UserRound, MapPin } from 'lucide-react'
import { Brand, Notice } from '../components/ui'
import { requireClient } from '../lib/supabase/client'
import { errorMessage, registrationSchema, safeReturn } from '../lib/utils'
import { useAuth } from '../features/auth/AuthProvider'
import { BusIllustration } from '../components/BusIllustration'
export function AuthPage({ mode }: { mode: 'login' | 'register' | 'reset' | 'update-password' }) {
  const register = mode === 'register'
  const reset = mode === 'reset'
  const update = mode === 'update-password'
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const intended = safeReturn(params.get('returnTo'))
  const { user, profile, error: accountError } = useAuth()
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState(
    params.get('registered') === '1'
      ? 'Account registration submitted. Check your email to verify your account if confirmation is enabled, then sign in.'
      : '',
  )
  useEffect(() => {
    if (mode === 'login' && user && profile && params.get('registered') !== '1')
      navigate(
        profile.role === 'admin'
          ? '/admin'
          : profile.role === 'employee'
            ? '/employee'
            : intended || '/',
        { replace: true },
      )
  }, [user, profile, navigate, mode, intended, params])
  async function submit(form: HTMLFormElement) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const client = requireClient()
      const values = Object.fromEntries(new FormData(form).entries()) as Record<string, string>
      if (register) {
        const checked = registrationSchema.safeParse(values)
        if (!checked.success) throw new Error(checked.error.issues[0].message)
        const { first_name, last_name, email, password } = checked.data
        const { error } = await client.auth.signUp({
          email,
          password,
          options: {
            data: { first_name, last_name },
            emailRedirectTo: `${window.location.origin}/login`,
          },
        })
        if (error) throw error
        await client.auth.signOut()
        navigate(
          `/login?registered=1${intended ? `&returnTo=${encodeURIComponent(intended)}` : ''}`,
          { replace: true },
        )
      } else if (reset) {
        const { error } = await client.auth.resetPasswordForEmail(values.email, {
          redirectTo: `${window.location.origin}/update-password`,
        })
        if (error) throw error
        setMessage(
          'If an account exists for that email, you’ll receive a password reset link. Check your inbox and spam folder.',
        )
      } else if (update) {
        if (values.password.length < 8) throw new Error('Use at least 8 characters.')
        if (values.password !== values.confirm) throw new Error('Passwords do not match.')
        const { error } = await client.auth.updateUser({ password: values.password })
        if (error) throw error
        await client.auth.signOut()
        setMessage('Password updated. You can now sign in with your new password.')
      } else {
        const { error } = await client.auth.signInWithPassword({
          email: values.email.trim(),
          password: values.password,
        })
        if (error) throw error
      }
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="auth-layout">
      <aside className="auth-aside">
        <Brand light />
        <div>
          <span className="eyebrow">YOUR JOURNEY, CONNECTED.</span>
          <h1>
            A little less waiting.
            <br />A lot more peace of mind.
          </h1>
          <p>
            Your bus, your route, and your next pickup.
            <br />
            All in one place.
          </p>
          <BusIllustration />
        </div>
        <span className="auth-location">
          <MapPin size={16} /> Mamburao, Occidental Mindoro
        </span>
      </aside>
      <div className="auth-main">
        <Link className="auth-back" to="/">
          Back to BUSTRA
        </Link>
        <div className="auth-form-wrap">
          <div className="auth-mobile-brand">
            <Brand />
          </div>
          <span className="eyebrow">
            {register
              ? 'START YOUR JOURNEY'
              : reset || update
                ? 'ACCOUNT RECOVERY'
                : 'WELCOME BACK'}
          </span>
          <h1>
            {register
              ? 'Create an account'
              : reset
                ? 'Forgot your password?'
                : update
                  ? 'Choose a new password'
                  : 'Sign in to BUSTRA'}
          </h1>
          <p className="auth-intro">
            {register
              ? 'Your next ride starts with a simple sign up.'
              : reset
                ? 'We’ll send you a link to reset it.'
                : update
                  ? 'Use a strong password with at least 8 characters.'
                  : 'Good to see you. Let’s get you on your way.'}
          </p>
          {(error || accountError) && <Notice tone="error">{error || accountError}</Notice>}
          {message && <Notice tone="success">{message}</Notice>}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submit(e.currentTarget)
            }}
          >
            {register && (
              <div className="form-two-col">
                <label className="field">
                  <span>First name</span>
                  <div className="input-icon">
                    <UserRound size={17} />
                    <input
                      name="first_name"
                      autoComplete="given-name"
                      placeholder="First name"
                      required
                      maxLength={80}
                    />
                  </div>
                </label>
                <label className="field">
                  <span>Last name</span>
                  <div className="input-icon">
                    <UserRound size={17} />
                    <input
                      name="last_name"
                      autoComplete="family-name"
                      placeholder="Last name"
                      required
                      maxLength={80}
                    />
                  </div>
                </label>
              </div>
            )}
            {!update && (
              <label className="field">
                <span>Email address</span>
                <div className="input-icon">
                  <Mail size={18} />
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    required
                  />
                </div>
              </label>
            )}
            {!reset && (
              <label className="field">
                <span>Password</span>
                <div className="input-icon">
                  <LockKeyhole size={18} />
                  <input
                    name="password"
                    type={visible ? 'text' : 'password'}
                    autoComplete={register || update ? 'new-password' : 'current-password'}
                    placeholder={
                      register || update ? 'At least 8 characters' : 'Enter your password'
                    }
                    minLength={register || update ? 8 : 1}
                    maxLength={128}
                    required
                  />
                  <button
                    type="button"
                    aria-label={visible ? 'Hide password' : 'Show password'}
                    onClick={() => setVisible(!visible)}
                  >
                    {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>
            )}
            {(register || update) && (
              <label className="field">
                <span>Confirm password</span>
                <div className="input-icon">
                  <LockKeyhole size={18} />
                  <input
                    name="confirm"
                    type={visible ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="Re-enter your password"
                    required
                  />
                </div>
              </label>
            )}
            {mode === 'login' && (
              <div className="forgot-line">
                <Link to="/reset-password">Forgot password?</Link>
              </div>
            )}
            {register && (
              <p className="form-help">
                All new accounts are passenger accounts. Staff access is assigned by the
                administrator.
              </p>
            )}
            <button className="button button-primary full-width" type="submit" disabled={busy}>
              {busy
                ? 'Please wait…'
                : register
                  ? 'Register'
                  : reset
                    ? 'Send reset link'
                    : update
                      ? 'Update password'
                      : 'Sign in'}
            </button>
          </form>
          <p className="auth-switch">
            {register
              ? 'Already have an account?'
              : reset || update
                ? 'Ready to continue?'
                : 'New to BUSTRA?'}{' '}
            <Link
              to={
                register || reset || update
                  ? `/login${intended ? `?returnTo=${encodeURIComponent(intended)}` : ''}`
                  : `/register${intended ? `?returnTo=${encodeURIComponent(intended)}` : ''}`
              }
            >
              {register || reset || update ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
          <div className="auth-divider" />
          <p className="auth-public-note">
            Just looking around? <Link to="/map">Explore the map without an account.</Link>
          </p>
        </div>
        <span className="auth-copyright">
          © {new Date().getFullYear()} BUSTRA · Your journey, connected.
        </span>
      </div>
    </div>
  )
}
